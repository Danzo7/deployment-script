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

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Bind address: localhost by default, overridden by REMOTE_BIND env var. */
const BIND_ADDRESS = process.env.REMOTE_BIND ?? 'localhost';

/** Hard cap on simultaneous SSH sessions (all keys combined). */
const MAX_SESSIONS = parseInt(process.env.REMOTE_MAX_SESSIONS ?? '10', 10);

/** Hard cap on simultaneous SSH sessions per authenticated key fingerprint. */
const MAX_SESSIONS_PER_KEY = parseInt(process.env.REMOTE_MAX_SESSIONS_PER_KEY ?? '3', 10);

/** Idle session timeout in milliseconds (default 30 minutes). */
const IDLE_TIMEOUT_MS = parseInt(process.env.REMOTE_IDLE_TIMEOUT_MS ?? String(30 * 60 * 1000), 10);

// ── Session tracking ─────────────────────────────────────────────────────────

interface ActiveSession {
  child: IPty;
  channel: ServerChannel;
  idleTimer: ReturnType<typeof setTimeout>;
  ip: string;
  identity: string;
  keyFingerprint: string;
}

const activeSessions = new Set<ActiveSession>();

/** Count of active sessions per key fingerprint. */
const sessionsByKey = new Map<string, number>();

function registerSession(session: ActiveSession): void {
  activeSessions.add(session);
  sessionsByKey.set(session.keyFingerprint, (sessionsByKey.get(session.keyFingerprint) ?? 0) + 1);
}

function unregisterSession(session: ActiveSession): void {
  clearTimeout(session.idleTimer);
  activeSessions.delete(session);
  const prev = sessionsByKey.get(session.keyFingerprint) ?? 1;
  if (prev <= 1) sessionsByKey.delete(session.keyFingerprint);
  else sessionsByKey.set(session.keyFingerprint, prev - 1);
}

function resetIdleTimer(session: ActiveSession): void {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    auditLog({ event: 'session-idle-timeout', ip: session.ip, identity: session.identity });
    session.child.kill();
    try { session.channel.end(); } catch { /* ignore */ }
  }, IDLE_TIMEOUT_MS);
}

// ── PTY helpers ───────────────────────────────────────────────────────────────

function resolveDmEntrypoint(): string {
  return resolve(ROOT_DIR, 'dist/cli.js');
}

function spawnReplSession(cols: number, rows: number, term: string, identity: string): IPty {
  return pty.spawn(process.execPath, [resolveDmEntrypoint()], {
    name: term || 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: ROOT_DIR,
    env: {
      ...(process.env as Record<string, string>),
      DM_REMOTE_USER: identity,
    },
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function drainAndExit(): void {
  if (activeSessions.size === 0) {
    process.exit(0);
  }
  Logger.info(`[remote] SIGTERM received — draining ${activeSessions.size} active session(s)…`);
  for (const s of activeSessions) {
    try { s.child.kill(); } catch { /* ignore */ }
    try { s.channel.end(); } catch { /* ignore */ }
  }
  // Give sessions 5 s to flush, then hard exit.
  setTimeout(() => process.exit(0), 5_000).unref();
}

// ── Server ────────────────────────────────────────────────────────────────────

export async function startRemoteServer(port: number): Promise<void> {
  const hostKey = loadOrCreateHostKey();
  const fingerprint = fingerprintHostKey(hostKey);

  process.on('SIGTERM', drainAndExit);
  process.on('SIGINT', drainAndExit);

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    const ip = (client as any)._sock?.remoteAddress ?? 'unknown';
    let authedAs: { method: string; identity: string; fingerprint: string } | undefined;

    // ── Lockout check ────────────────────────────────────────────────────────
    const lockRemaining = isLockedOut(ip);
    if (lockRemaining > 0) {
      auditLog({ event: 'auth-throttled', ip, retryInMs: lockRemaining });
      client.end();
      return;
    }

    // ── Concurrent session cap ───────────────────────────────────────────────
    if (activeSessions.size >= MAX_SESSIONS) {
      auditLog({ event: 'session-limit-reached', ip, limit: MAX_SESSIONS });
      client.end();
      return;
    }
    client.on('authentication', (ctx) => {
      if (ctx.method === 'publickey') {
        const match = findAuthorizedKeyByPublicSSH(ctx.key.data as Buffer);
        if (!match) {
          recordFailedAttempt(ip);
          auditLog({ event: 'auth-fail', ip, method: 'publickey' });
          return ctx.reject();
        }
        // Client probing whether the key is acceptable — no signature yet.
        if (!ctx.signature) return ctx.accept();

        const ok = match.parsed.verify(ctx.blob as Buffer, ctx.signature as Buffer) === true;
        if (ok) {
          clearAttempts(ip);
          authedAs = { method: 'publickey', identity: match.comment || match.fingerprint, fingerprint: match.fingerprint };
          auditLog({ event: 'auth-ok', ip, method: 'publickey', fingerprint: match.fingerprint, user: match.comment || match.fingerprint });
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
      client.on('request', (_accept, reject) => reject && reject());

      client.on('session', (acceptSession) => {
        const session = acceptSession();
        let ptyCols = 80;
        let ptyRows = 24;
        let ptyTerm = 'xterm-256color';
        let activeSession: ActiveSession | undefined;

        session.on('pty', (acceptPty, _reject, info) => {
          ptyCols = info.cols;
          ptyRows = info.rows;
          ptyTerm = (info as any).term ?? 'xterm-256color';
          if (acceptPty) acceptPty();
        });

        session.on('window-change', (_accept, _reject, info) => {
          activeSession?.child.resize(info.cols, info.rows);
        });

        // ── Interactive REPL session ─────────────────────────────────────────
        session.on('shell', (acceptShell) => {
          const channel = acceptShell();
          const identity = authedAs?.identity ?? 'unknown';
          const keyFingerprint = authedAs?.fingerprint ?? 'unknown';

          // Per-key session limit check.
          const keySessions = sessionsByKey.get(keyFingerprint) ?? 0;
          if (keySessions >= MAX_SESSIONS_PER_KEY) {
            auditLog({ event: 'per-key-limit-reached', ip, fingerprint: keyFingerprint, limit: MAX_SESSIONS_PER_KEY });
            channel.stderr?.write(`Session limit reached for this key (max ${MAX_SESSIONS_PER_KEY}).\n`);
            channel.exit(1);
            channel.end();
            return;
          }

          auditLog({ event: 'shell-open', ip, ...authedAs });

          const child = spawnReplSession(ptyCols, ptyRows, ptyTerm, identity);

          const sess: ActiveSession = {
            child,
            channel,
            ip,
            identity,
            keyFingerprint,
            idleTimer: setTimeout(() => {}, 0), // placeholder; set properly below
          };
          registerSession(sess);
          resetIdleTimer(sess);

          child.onData((data: string) => {
            channel.write(data);
            resetIdleTimer(sess);
          });

          channel.on('data', (data: Buffer) => {
            child.write(data.toString('utf8'));
            resetIdleTimer(sess);
          });

          child.onExit(({ exitCode }: { exitCode: number }) => {
            unregisterSession(sess);
            channel.exit(exitCode);
            channel.end();
            auditLog({ event: 'shell-close', ip, ...authedAs, exitCode });
          });

          channel.on('close', () => {
            unregisterSession(sess);
            child.kill();
          });

          activeSession = sess;
        });

        // ── One-shot exec: `ssh -p 2022 host deploy myapp` ──────────────────
        session.on('exec', (acceptExec, rejectExec, info) => {
          const args = tokeniseShell(info.command);
          const identity = authedAs?.identity ?? 'unknown';
          const keyFingerprint = authedAs?.fingerprint ?? 'unknown';

          // Block remote-management commands from exec sessions — same set
          // enforced by the REPL dispatcher for interactive sessions.
          const BLOCKED_EXEC_COMMANDS = new Set(['remote', 'update', 'install-service', 'migrate-db']);
          const topLevelCmd = args[0];
          if (topLevelCmd && BLOCKED_EXEC_COMMANDS.has(topLevelCmd)) {
            const channel = acceptExec();
            auditLog({ event: 'exec-blocked', ip, ...authedAs, command: info.command });
            channel.stderr.write(`Command "${topLevelCmd}" is not allowed in a remote session.\n`);
            channel.exit(1);
            channel.end();
            return;
          }

          // Per-key session limit check.
          const keySessions = sessionsByKey.get(keyFingerprint) ?? 0;
          if (keySessions >= MAX_SESSIONS_PER_KEY) {
            const channel = acceptExec();
            auditLog({ event: 'per-key-limit-reached', ip, fingerprint: keyFingerprint, limit: MAX_SESSIONS_PER_KEY });
            channel.stderr.write(`Session limit reached for this key (max ${MAX_SESSIONS_PER_KEY}).\n`);
            channel.exit(1);
            channel.end();
            return;
          }

          const channel = acceptExec();
          auditLog({ event: 'exec', ip, ...authedAs, command: info.command });

          const child = pty.spawn(process.execPath, [resolveDmEntrypoint(), ...args], {
            name: ptyTerm || 'xterm-256color',
            cols: ptyCols || 80,
            rows: ptyRows || 24,
            cwd: ROOT_DIR,
            env: {
              ...(process.env as Record<string, string>),
              DM_REMOTE_USER: identity,
            },
          });

          const sess: ActiveSession = {
            child,
            channel,
            ip,
            identity,
            keyFingerprint,
            idleTimer: setTimeout(() => {}, 0),
          };
          registerSession(sess);
          resetIdleTimer(sess);

          child.onData((data: string) => {
            channel.write(data);
            resetIdleTimer(sess);
          });

          channel.on('data', (data: Buffer) => {
            child.write(data.toString('utf8'));
            resetIdleTimer(sess);
          });

          child.onExit(({ exitCode }: { exitCode: number }) => {
            unregisterSession(sess);
            channel.exit(exitCode);
            channel.end();
          });

          channel.on('close', () => {
            unregisterSession(sess);
            child.kill();
          });

          activeSession = sess;
        });
      });
    });

    client.on('close', () => {
      if (authedAs) auditLog({ event: 'disconnect', ip, ...authedAs });
    });

    // Kill the associated PTY on any client-level error so the process
    // doesn't linger after a network drop.
    client.on('error', (err) => {
      Logger.error(`[remote] client error (${ip}): ${err.message}`);
      for (const s of activeSessions) {
        if (s.ip === ip) {
          unregisterSession(s);
          try { s.child.kill(); } catch { /* ignore */ }
          try { s.channel.end(); } catch { /* ignore */ }
        }
      }
    });
  });

  await new Promise<void>((res, rej) => {
    server.listen(port, BIND_ADDRESS, res);
    server.on('error', rej);
  });

  const addr = server.address() as AddressInfo;
  Logger.success(`dm remote server listening on ${BIND_ADDRESS}:${addr.port}`);

  if (BIND_ADDRESS !== '127.0.0.1' && BIND_ADDRESS !== 'localhost') {
    Logger.warn(`WARNING: server is bound to ${BIND_ADDRESS} — reachable beyond localhost. Ensure firewall rules restrict access.`);
  }

  Logger.info(`Host key fingerprint: ${fingerprint}`);
  Logger.info('Share this fingerprint with anyone connecting for the first time.');
  Logger.info(`Max sessions: ${MAX_SESSIONS}  |  Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);

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
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (cur.length) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}
