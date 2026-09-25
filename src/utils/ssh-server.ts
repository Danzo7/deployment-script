// ─── dm remote SSH server ────────────────────────────────────────────────────
//
// Starts a locked-down SSH server that only ever exposes the `dm` REPL.
// No port forwarding, no SFTP, no arbitrary shell — only `dm`'s own
// command surface.
//
// Each session spawns a new `dm` child process (no args → REPL mode) inside
// a real pty via node-pty. This means readline, chalk, Ink, tab-completion,
// and Ctrl+C all work exactly as they do locally because the child genuinely
// has a TTY. Concurrent sessions are fully isolated — separate processes,
// separate DB connections, separate signal handlers.
//
// Security properties:
//  - Binds to 127.0.0.1 by default; opt in to wider exposure via REMOTE_BIND.
//  - Max concurrent sessions capped at REMOTE_MAX_SESSIONS (default 10).
//  - Idle sessions terminated after REMOTE_IDLE_TIMEOUT_MS (default 30 min).
//  - SIGTERM handler drains active sessions gracefully before exit.
//  - client 'error' events kill the associated PTY child to prevent leaks.
// ─────────────────────────────────────────────────────────────────────────────

import ssh2 from 'ssh2';
import type { ServerChannel } from 'ssh2';
import { createRequire } from 'module';
import { AddressInfo } from 'net';
import { EventEmitter } from 'events';

const { Server } = ssh2;
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';

interface IPty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
interface PtyModule {
  spawn(file: string, args: string[], options: Record<string, unknown>): IPty;
}

const _require = createRequire(import.meta.url);
const pty = _require('node-pty') as PtyModule;
import { loadOrCreateHostKey, fingerprintHostKey } from './ssh-host-key.js';
import {
  findAuthorizedKeyByPublicSSH,
  isLockedOut,
  recordFailedAttempt,
  clearAttempts,
  auditLog,
} from './remote-auth.js';
import {
  isCommandBlockedForRemote,
  getBlockedCommandMessage,
} from './remote-command-guard.js';
import { RemoteIpcServer } from './remote-ipc-server.js';
import { REMOTE_IPC_SOCKET_PATH } from '../constants.js';

// ── Public server event bus ───────────────────────────────────────────────────
// Consumers (e.g. TUI) subscribe to get live updates without polling.

export interface SessionSnapshot {
  id: string;
  identity: string;
  ip: string;
  keyFingerprint: string;
  connectedAt: Date;
  sessionType: 'shell' | 'exec';
}

export type ServerEventMap = {
  log: [level: 'info' | 'warn' | 'error' | 'success', message: string];
  'session-open': [session: SessionSnapshot];
  'session-close': [sessionId: string];
  listening: [address: string, port: number, fingerprint: string];
};

class TypedEmitter extends EventEmitter {
  emit<K extends keyof ServerEventMap>(
    event: K,
    ...args: ServerEventMap[K]
  ): boolean {
    return super.emit(event as string, ...args);
  }
  on<K extends keyof ServerEventMap>(
    event: K,
    listener: (...args: ServerEventMap[K]) => void
  ): this {
    return super.on(event as string, listener as (...args: unknown[]) => void);
  }
  off<K extends keyof ServerEventMap>(
    event: K,
    listener: (...args: ServerEventMap[K]) => void
  ): this {
    return super.off(event as string, listener as (...args: unknown[]) => void);
  }
}

export const serverEvents = new TypedEmitter();

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Bind address: localhost by default, overridden by REMOTE_BIND env var. */
const BIND_ADDRESS = process.env.REMOTE_BIND ?? 'localhost';

/** Hard cap on simultaneous SSH sessions (all keys combined). */
const MAX_SESSIONS = parseInt(process.env.REMOTE_MAX_SESSIONS ?? '10', 10);

/** Hard cap on simultaneous SSH sessions per authenticated key fingerprint. */
const MAX_SESSIONS_PER_KEY = parseInt(
  process.env.REMOTE_MAX_SESSIONS_PER_KEY ?? '3',
  10
);

/** Idle session timeout in milliseconds (default 30 minutes). */
const IDLE_TIMEOUT_MS = parseInt(
  process.env.REMOTE_IDLE_TIMEOUT_MS ?? String(30 * 60 * 1000),
  10
);

// ── Session tracking ─────────────────────────────────────────────────────────

interface ActiveSession {
  id: string;
  child: IPty;
  channel: ServerChannel;
  idleTimer: ReturnType<typeof setTimeout>;
  ip: string;
  identity: string;
  keyFingerprint: string;
  connectedAt: Date;
  sessionType: 'shell' | 'exec';
  cleanupOnce?: (reason: string) => void;
}

const activeSessions = new Set<ActiveSession>();

/** Count of active sessions per key fingerprint. */
const sessionsByKey = new Map<string, number>();

let _sessionCounter = 0;
export function generateSessionId(): string {
  return `s${++_sessionCounter}`;
}

export function getActiveSessions(): SessionSnapshot[] {
  return Array.from(activeSessions).map((s) => ({
    id: s.id,
    identity: s.identity,
    ip: s.ip,
    keyFingerprint: s.keyFingerprint,
    connectedAt: s.connectedAt,
    sessionType: s.sessionType,
  }));
}

export function disconnectSession(sessionId: string): boolean {
  for (const s of activeSessions) {
    if (s.id === sessionId) {
      auditLog({
        event: 'session-force-disconnect',
        ip: s.ip,
        identity: s.identity,
      });
      s.child.kill();
      try {
        s.channel.end();
      } catch {
        /* ignore */
      }
      return true;
    }
  }
  return false;
}

function registerSession(session: ActiveSession): void {
  activeSessions.add(session);
  sessionsByKey.set(
    session.keyFingerprint,
    (sessionsByKey.get(session.keyFingerprint) ?? 0) + 1
  );
  serverEvents.emit('session-open', {
    id: session.id,
    identity: session.identity,
    ip: session.ip,
    keyFingerprint: session.keyFingerprint,
    connectedAt: session.connectedAt,
    sessionType: session.sessionType,
  });
}

function unregisterSession(session: ActiveSession): void {
  clearTimeout(session.idleTimer);
  activeSessions.delete(session);
  const prev = sessionsByKey.get(session.keyFingerprint) ?? 1;
  if (prev <= 1) sessionsByKey.delete(session.keyFingerprint);
  else sessionsByKey.set(session.keyFingerprint, prev - 1);
  serverEvents.emit('session-close', session.id);
}

function resetIdleTimer(session: ActiveSession): void {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    auditLog({
      event: 'session-idle-timeout',
      ip: session.ip,
      identity: session.identity,
    });
    try {
      // Gracefully kill PTY - wrap to prevent node-pty crashes on Windows
      session.child.kill();
    } catch (err: any) {
      // Ignore node-pty AttachConsole errors on Windows
    }
    try {
      session.channel.end();
    } catch {
      /* ignore */
    }
  }, IDLE_TIMEOUT_MS);
}

// ── PTY helpers ───────────────────────────────────────────────────────────────

function resolveDmEntrypoint(): string {
  return resolve(ROOT_DIR, 'dist/cli.js');
}

// ── Logging helpers ───────────────────────────────────────────────────────────

function slog(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string
): void {
  serverEvents.emit('log', level, message);
  Logger[level](message);
}

function spawnReplSession(
  cols: number,
  rows: number,
  term: string,
  identity: string,
  sessionType: 'shell' | 'exec'
): IPty {
  try {
    return pty.spawn(process.execPath, [resolveDmEntrypoint()], {
      name: term || 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: ROOT_DIR,
      env: {
        ...(process.env as Record<string, string>),
        DM_REMOTE_USER: identity,
        DM_REMOTE_SESSION_TYPE: sessionType,
      },
    });
  } catch (err: any) {
    // Log error but rethrow - caller needs to handle spawn failure
    slog('error', `[remote] Failed to spawn PTY: ${err.message}`);
    throw err;
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function drainAndExit(): void {
  // Stop IPC server first
  if (ipcServer) {
    ipcServer.stop().catch(() => {/* ignore */});
  }

  if (activeSessions.size === 0) {
    process.exit(0);
  }
  Logger.info(
    `[remote] SIGTERM received — draining ${activeSessions.size} active session(s)…`
  );
  for (const s of activeSessions) {
    try {
      // Gracefully kill PTY - wrap to prevent node-pty crashes on Windows
      s.child.kill();
    } catch (err: any) {
      // Ignore node-pty AttachConsole errors on Windows
    }
    try {
      s.channel.end();
    } catch {
      /* ignore */
    }
  }
  // Give sessions 5 s to flush, then hard exit.
  setTimeout(() => process.exit(0), 5_000).unref();
}

// ── Server ────────────────────────────────────────────────────────────────────

let ipcServer: RemoteIpcServer | null = null;

export async function startRemoteServer(port: number): Promise<void> {
  const hostKey = loadOrCreateHostKey();
  const fingerprint = fingerprintHostKey(hostKey);

  // Global error handlers to prevent process crashes
  process.on('uncaughtException', (err) => {
    slog('error', `[remote] Uncaught exception: ${err.message}`);
    // Don't exit - log and continue
  });

  process.on('unhandledRejection', (reason: any) => {
    slog('error', `[remote] Unhandled rejection: ${reason?.message ?? reason}`);
    // Don't exit - log and continue
  });

  process.on('SIGTERM', drainAndExit);
  process.on('SIGINT', drainAndExit);

  const server = new Server({ hostKeys: [hostKey] }, (client, info) => {
    // Wrap entire handler in try-catch to prevent any uncaught errors
    try {
      handleClient(client, info);
    } catch (err: any) {
      slog('error', `[remote] Error in client handler: ${err.message}`);
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
  });

  // Attach server error handler BEFORE listen() to prevent race condition
  server.on('error', (err: Error) => {
    slog('error', `[remote] server error: ${err.message}`);
    // Log but don't crash - server should continue running
  });

  // Extract client handling logic into a function
  function handleClient(client: any, info: any): void {
    const ip = info.ip ?? 'unknown';
    let authedAs:
      | { method: string; identity: string; fingerprint: string }
      | undefined;

    Logger.info(`[remote] connection attempt from ${ip}`);

    // ── Lockout check ────────────────────────────────────────────────────────
    const lockRemaining = isLockedOut(ip);
    if (lockRemaining > 0) {
      auditLog({ event: 'auth-throttled', ip, retryInMs: lockRemaining });
      slog('warn', `[remote] ${ip} is rate-limited — rejected`);
      client.end();
      return;
    }

    // ── Concurrent session cap ───────────────────────────────────────────────
    if (activeSessions.size >= MAX_SESSIONS) {
      auditLog({ event: 'session-limit-reached', ip, limit: MAX_SESSIONS });
      client.end();
      return;
    }
    client.on('authentication', (ctx: any) => {
      if (ctx.method === 'publickey') {
        const match = findAuthorizedKeyByPublicSSH(ctx.key.data as Buffer);
        if (!match) {
          recordFailedAttempt(ip);
          auditLog({ event: 'auth-fail', ip, method: 'publickey' });
          return ctx.reject();
        }
        // Client probing whether the key is acceptable — no signature yet.
        if (!ctx.signature) return ctx.accept();

        const ok =
          match.parsed.verify(ctx.blob as Buffer, ctx.signature as Buffer) ===
          true;
        if (ok) {
          clearAttempts(ip);
          authedAs = {
            method: 'publickey',
            identity: match.comment || match.fingerprint,
            fingerprint: match.fingerprint,
          };
          auditLog({
            event: 'auth-ok',
            ip,
            method: 'publickey',
            fingerprint: match.fingerprint,
            user: match.comment || match.fingerprint,
          });
          slog(
            'success',
            `[remote] authenticated: ${authedAs.identity} from ${ip}`
          );
          return ctx.accept();
        }
        recordFailedAttempt(ip);
        auditLog({ event: 'auth-fail', ip, method: 'publickey' });
        return ctx.reject();
      }

      // Reject anything other than publickey — password auth is disabled.
      return ctx.reject(['publickey'] as any);
    });

    client.on('ready', () => {
      // Explicitly reject all global requests (port forwarding, X11, etc.)
      client.on('request', (_accept: any, reject: any, name: any) => {
        if (reject) {
          auditLog({
            event: 'global-request-blocked',
            ip,
            requestType: name,
            identity: authedAs?.identity,
          });
          reject();
        }
      });

      client.on('session', (acceptSession: any) => {
        const session = acceptSession();
        
        // Add error handler to session to prevent crashes
        session.on('error', (err: any) => {
          slog('error', `[remote] session error: ${err.message}`);
        });
        
        let ptyCols = 80;
        let ptyRows = 24;
        let ptyTerm = 'xterm-256color';
        let activeSession: ActiveSession | undefined;

        session.on('pty', (acceptPty: any, _reject: any, info: any) => {
          ptyCols = info.cols;
          ptyRows = info.rows;
          ptyTerm = (info as any).term ?? 'xterm-256color';
          if (acceptPty) acceptPty();
        });

        session.on('window-change', (_accept: any, _reject: any, info: any) => {
          activeSession?.child.resize(info.cols, info.rows);
        });

        // ── Block SFTP and other subsystems ──────────────────────────────────
        session.on('subsystem', (accept: any, reject: any, info: any) => {
          auditLog({
            event: 'subsystem-blocked',
            ip,
            subsystem: info.name,
            identity: authedAs?.identity,
          });
          if (reject) reject();
        });

        // ── Interactive REPL session ─────────────────────────────────────────
        session.on('shell', (acceptShell: any) => {
          const channel = acceptShell();
          
          // Add error handler immediately to prevent crashes
          channel.on('error', (err: any) => {
            slog('error', `[remote] channel error: ${err.message}`);
          });
          
          const identity = authedAs?.identity ?? 'unknown';
          const keyFingerprint = authedAs?.fingerprint ?? 'unknown';

          // Per-key session limit check.
          const keySessions = sessionsByKey.get(keyFingerprint) ?? 0;
          if (keySessions >= MAX_SESSIONS_PER_KEY) {
            auditLog({
              event: 'per-key-limit-reached',
              ip,
              fingerprint: keyFingerprint,
              limit: MAX_SESSIONS_PER_KEY,
            });
            try {
              channel.stderr?.write(
                `Session limit reached for this key (max ${MAX_SESSIONS_PER_KEY}).\n`
              );
              channel.exit(1);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
            return;
          }

          auditLog({ event: 'shell-open', ip, ...authedAs });

          let child: IPty;
          try {
            child = spawnReplSession(ptyCols, ptyRows, ptyTerm, identity, 'shell');
          } catch (err: any) {
            // Failed to spawn PTY - notify client and abort
            try {
              channel.stderr?.write(`Failed to start session: ${err.message}\n`);
              channel.exit(1);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
            return;
          }

          let cleanedUp = false;

          const sess: ActiveSession = {
            id: generateSessionId(),
            child,
            channel,
            ip,
            identity,
            keyFingerprint,
            connectedAt: new Date(),
            sessionType: 'shell',
            idleTimer: setTimeout(() => {}, 0), // placeholder; set properly below
          };

          // Guard against double-kill: only kill the pty once, no matter which path gets there first
          sess.cleanupOnce = (reason: string) => {
            if (cleanedUp) return;
            cleanedUp = true;
            unregisterSession(sess);
            try {
              // Gracefully kill PTY - wrap in try-catch to prevent node-pty crashes on Windows
              child.kill();
            } catch (err: any) {
              // Ignore errors - node-pty on Windows can throw AttachConsole errors during cleanup
              // This is a known issue with ConPTY on Windows when the console is already detached
            }
          };

          registerSession(sess);
          resetIdleTimer(sess);
          slog(
            'info',
            `[remote] session opened — user: ${identity}  ip: ${ip}  active sessions: ${activeSessions.size}`
          );

          child.onData((data: string) => {
            try {
              channel.write(data);
            } catch {
              /* ignore write errors on closed channel */
            }
            resetIdleTimer(sess);
          });

          channel.on('data', (data: Buffer) => {
            try {
              child.write(data.toString('utf8'));
            } catch {
              /* ignore write errors if child already exited */
            }
            resetIdleTimer(sess);
          });

          child.onExit(({ exitCode }: { exitCode: number }) => {
            // PTY exited on its own — don't kill it again, just mark as cleaned up
            cleanedUp = true;
            unregisterSession(sess);
            try {
              channel.exit(exitCode);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
            auditLog({ event: 'shell-close', ip, ...authedAs, exitCode });
            slog(
              'info',
              `[remote] session closed — user: ${identity}  ip: ${ip}  active sessions: ${activeSessions.size}`
            );
          });

          channel.on('close', () => {
            sess.cleanupOnce?.('channel-close');
          });

          activeSession = sess;
        });

        // ── One-shot exec: `ssh -p 2022 host deploy myapp` ──────────────────
        session.on('exec', (acceptExec: any, rejectExec: any, info: any) => {
          const args = tokeniseShell(info.command);
          const identity = authedAs?.identity ?? 'unknown';
          const keyFingerprint = authedAs?.fingerprint ?? 'unknown';

          // Block CLI-only commands from exec sessions using the same logic
          // as the interactive REPL dispatcher.
          const topLevelCmd = args[0];
          if (topLevelCmd && isCommandBlockedForRemote(topLevelCmd)) {
            const channel = acceptExec();
            
            // Add error handler immediately
            channel.on('error', (err: any) => {
              slog('error', `[remote] exec channel error: ${err.message}`);
            });
            
            auditLog({
              event: 'exec-blocked',
              ip,
              ...authedAs,
              command: info.command,
            });
            try {
              channel.stderr.write(getBlockedCommandMessage(topLevelCmd) + '\n');
              channel.exit(1);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
            return;
          }

          // Per-key session limit check.
          const keySessions = sessionsByKey.get(keyFingerprint) ?? 0;
          if (keySessions >= MAX_SESSIONS_PER_KEY) {
            const channel = acceptExec();
            
            // Add error handler immediately
            channel.on('error', (err: any) => {
              slog('error', `[remote] exec channel error: ${err.message}`);
            });
            
            auditLog({
              event: 'per-key-limit-reached',
              ip,
              fingerprint: keyFingerprint,
              limit: MAX_SESSIONS_PER_KEY,
            });
            try {
              channel.stderr.write(
                `Session limit reached for this key (max ${MAX_SESSIONS_PER_KEY}).\n`
              );
              channel.exit(1);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
            return;
          }

          const channel = acceptExec();
          
          // Add error handler immediately
          channel.on('error', (err: any) => {
            slog('error', `[remote] exec channel error: ${err.message}`);
          });
          
          auditLog({ event: 'exec', ip, ...authedAs, command: info.command });

          let child: IPty;
          try {
            child = pty.spawn(
              process.execPath,
              [resolveDmEntrypoint(), ...args],
              {
                name: ptyTerm || 'xterm-256color',
                cols: ptyCols || 80,
                rows: ptyRows || 24,
                cwd: ROOT_DIR,
                env: {
                  ...(process.env as Record<string, string>),
                  DM_REMOTE_USER: identity,
                  DM_REMOTE_SESSION_TYPE: 'exec',
                },
              }
            );
          } catch (err: any) {
            // Failed to spawn PTY - notify client and abort
            try {
              channel.stderr.write(`Failed to execute command: ${err.message}\n`);
              channel.exit(1);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
            return;
          }

          let execCleanedUp = false;

          const sess: ActiveSession = {
            id: generateSessionId(),
            child,
            channel,
            ip,
            identity,
            keyFingerprint,
            connectedAt: new Date(),
            sessionType: 'exec',
            idleTimer: setTimeout(() => {}, 0),
          };

          // Guard against double-kill for exec sessions too
          sess.cleanupOnce = (reason: string) => {
            if (execCleanedUp) return;
            execCleanedUp = true;
            unregisterSession(sess);
            try {
              // Gracefully kill PTY - wrap in try-catch to prevent node-pty crashes on Windows
              child.kill();
            } catch (err: any) {
              // Ignore errors - node-pty on Windows can throw AttachConsole errors during cleanup
              // This is a known issue with ConPTY on Windows when the console is already detached
            }
          };

          registerSession(sess);
          resetIdleTimer(sess);

          child.onData((data: string) => {
            try {
              channel.write(data);
            } catch {
              /* ignore write errors on closed channel */
            }
            resetIdleTimer(sess);
          });

          channel.on('data', (data: Buffer) => {
            try {
              child.write(data.toString('utf8'));
            } catch {
              /* ignore write errors if child already exited */
            }
            resetIdleTimer(sess);
          });

          child.onExit(({ exitCode }: { exitCode: number }) => {
            // PTY exited on its own — don't kill it again, just mark as cleaned up
            execCleanedUp = true;
            unregisterSession(sess);
            try {
              channel.exit(exitCode);
              channel.end();
            } catch {
              /* ignore errors on already-closed channel */
            }
          });

          channel.on('close', () => {
            sess.cleanupOnce?.('channel-close');
          });

          activeSession = sess;
        });
      });
    });

    client.on('close', () => {
      if (authedAs) {
        auditLog({ event: 'disconnect', ip, ...authedAs });
        slog(
          'info',
          `[remote] disconnected — user: ${authedAs.identity}  ip: ${ip}`
        );
      } else {
        slog('info', `[remote] unauthenticated connection closed from ${ip}`);
      }
    });

    // Kill the associated PTY on any client-level error so the process
    // doesn't linger after a network drop.
    client.on('error', (err: any) => {
      slog('error', `[remote] client error (${ip}): ${err.message}`);
      // Create a snapshot of sessions to avoid modifying Set during iteration
      const sessionsToCleanup = Array.from(activeSessions).filter(
        (s) => s.ip === ip
      );
      for (const s of sessionsToCleanup) {
        // Use the guarded cleanup to prevent double-kill
        s.cleanupOnce?.('client-error');
      }
      
      // Don't explicitly call client.end() - let the client close naturally
      // to avoid potential cascade errors. The 'close' event will fire anyway.
    });
  } // End of handleClient function


  // Start listening with proper error handling
  await new Promise<void>((res, rej) => {
    server.listen(port, BIND_ADDRESS, res);
    // Only reject on startup errors (port in use, permission denied, etc.)
    server.once('error', rej);
  });

  const addr = server.address() as AddressInfo;
  slog('success', `dm remote server listening on ${BIND_ADDRESS}:${addr.port}`);

  if (BIND_ADDRESS !== '127.0.0.1' && BIND_ADDRESS !== 'localhost') {
    slog(
      'warn',
      `WARNING: server is bound to ${BIND_ADDRESS} — reachable beyond localhost. Ensure firewall rules restrict access.`
    );
  }

  slog('info', `Host key fingerprint: ${fingerprint}`);
  slog(
    'info',
    'Share this fingerprint with anyone connecting for the first time.'
  );
  slog(
    'info',
    `Max sessions: ${MAX_SESSIONS}  |  Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`
  );

  serverEvents.emit('listening', BIND_ADDRESS, addr.port, fingerprint);

  // ── Start IPC Server ──────────────────────────────────────────────────────
  try {
    ipcServer = new RemoteIpcServer(REMOTE_IPC_SOCKET_PATH);
    
    // Update IPC server with current status
    ipcServer.updateStatus({
      running: true,
      bindAddress: BIND_ADDRESS,
      port: addr.port,
      fingerprint,
    });

    // Handle IPC requests
    ipcServer.on('status-request', (callback: (sessions: SessionSnapshot[]) => void) => {
      callback(getActiveSessions());
    });

    ipcServer.on('sessions-request', (callback: (sessions: SessionSnapshot[]) => void) => {
      callback(getActiveSessions());
    });

    ipcServer.on('disconnect-request', (sessionId: string, callback: (success: boolean) => void) => {
      const success = disconnectSession(sessionId);
      callback(success);
    });

    ipcServer.on('shutdown-request', () => {
      slog('info', '[remote] Shutdown requested via IPC');
      drainAndExit();
    });

    // Forward server events to IPC clients
    serverEvents.on('session-open', (session) => {
      ipcServer?.broadcastEvent('session-open', session);
    });

    serverEvents.on('session-close', (sessionId) => {
      ipcServer?.broadcastEvent('session-close', sessionId);
    });

    serverEvents.on('log', (level, message) => {
      ipcServer?.broadcastEvent('log', { level, message });
    });

    await ipcServer.start();
    slog('info', `[remote] IPC server started on ${REMOTE_IPC_SOCKET_PATH}`);
  } catch (err: any) {
    slog('warn', `[remote] Failed to start IPC server: ${err.message}`);
    // Continue without IPC - not critical
  }

  // Keep alive — process is managed by PM2.
  await new Promise<void>(() => {});
}

// ── Shell tokeniser ──────────────────────────────────────────────────────────

function tokeniseShell(command: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (cur.length) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}
