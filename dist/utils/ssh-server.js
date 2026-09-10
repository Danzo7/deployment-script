import ssh2 from "ssh2";
import { createRequire } from "module";
import { EventEmitter } from "events";
const { Server } = ssh2;
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Logger } from "./logger.js";
const _require = createRequire(import.meta.url);
const pty = _require("node-pty");
import { loadOrCreateHostKey, fingerprintHostKey } from "./ssh-host-key.js";
import {
  findAuthorizedKeyByPublicSSH,
  isLockedOut,
  recordFailedAttempt,
  clearAttempts,
  auditLog
} from "./remote-auth.js";
class TypedEmitter extends EventEmitter {
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  off(event, listener) {
    return super.off(event, listener);
  }
}
const serverEvents = new TypedEmitter();
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BIND_ADDRESS = process.env.REMOTE_BIND ?? "localhost";
const MAX_SESSIONS = parseInt(process.env.REMOTE_MAX_SESSIONS ?? "10", 10);
const MAX_SESSIONS_PER_KEY = parseInt(
  process.env.REMOTE_MAX_SESSIONS_PER_KEY ?? "3",
  10
);
const IDLE_TIMEOUT_MS = parseInt(
  process.env.REMOTE_IDLE_TIMEOUT_MS ?? String(30 * 60 * 1e3),
  10
);
const activeSessions = /* @__PURE__ */ new Set();
const sessionsByKey = /* @__PURE__ */ new Map();
let _sessionCounter = 0;
function generateSessionId() {
  return `s${++_sessionCounter}`;
}
function getActiveSessions() {
  return Array.from(activeSessions).map((s) => ({
    id: s.id,
    identity: s.identity,
    ip: s.ip,
    keyFingerprint: s.keyFingerprint,
    connectedAt: s.connectedAt,
    sessionType: s.sessionType
  }));
}
function disconnectSession(sessionId) {
  for (const s of activeSessions) {
    if (s.id === sessionId) {
      auditLog({
        event: "session-force-disconnect",
        ip: s.ip,
        identity: s.identity
      });
      s.child.kill();
      try {
        s.channel.end();
      } catch {
      }
      return true;
    }
  }
  return false;
}
function registerSession(session) {
  activeSessions.add(session);
  sessionsByKey.set(
    session.keyFingerprint,
    (sessionsByKey.get(session.keyFingerprint) ?? 0) + 1
  );
  serverEvents.emit("session-open", {
    id: session.id,
    identity: session.identity,
    ip: session.ip,
    keyFingerprint: session.keyFingerprint,
    connectedAt: session.connectedAt,
    sessionType: session.sessionType
  });
}
function unregisterSession(session) {
  clearTimeout(session.idleTimer);
  activeSessions.delete(session);
  const prev = sessionsByKey.get(session.keyFingerprint) ?? 1;
  if (prev <= 1) sessionsByKey.delete(session.keyFingerprint);
  else sessionsByKey.set(session.keyFingerprint, prev - 1);
  serverEvents.emit("session-close", session.id);
}
function resetIdleTimer(session) {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    auditLog({
      event: "session-idle-timeout",
      ip: session.ip,
      identity: session.identity
    });
    session.child.kill();
    try {
      session.channel.end();
    } catch {
    }
  }, IDLE_TIMEOUT_MS);
}
function resolveDmEntrypoint() {
  return resolve(ROOT_DIR, "dist/cli.js");
}
function slog(level, message) {
  serverEvents.emit("log", level, message);
  Logger[level](message);
}
function spawnReplSession(cols, rows, term, identity) {
  return pty.spawn(process.execPath, [resolveDmEntrypoint()], {
    name: term || "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      DM_REMOTE_USER: identity
    }
  });
}
function drainAndExit() {
  if (activeSessions.size === 0) {
    process.exit(0);
  }
  Logger.info(
    `[remote] SIGTERM received \u2014 draining ${activeSessions.size} active session(s)\u2026`
  );
  for (const s of activeSessions) {
    try {
      s.child.kill();
    } catch {
    }
    try {
      s.channel.end();
    } catch {
    }
  }
  setTimeout(() => process.exit(0), 5e3).unref();
}
async function startRemoteServer(port) {
  const hostKey = loadOrCreateHostKey();
  const fingerprint = fingerprintHostKey(hostKey);
  process.on("SIGTERM", drainAndExit);
  process.on("SIGINT", drainAndExit);
  const server = new Server({ hostKeys: [hostKey] }, (client, info) => {
    const ip = info.ip ?? "unknown";
    let authedAs;
    Logger.info(`[remote] connection attempt from ${ip}`);
    const lockRemaining = isLockedOut(ip);
    if (lockRemaining > 0) {
      auditLog({ event: "auth-throttled", ip, retryInMs: lockRemaining });
      slog("warn", `[remote] ${ip} is rate-limited \u2014 rejected`);
      client.end();
      return;
    }
    if (activeSessions.size >= MAX_SESSIONS) {
      auditLog({ event: "session-limit-reached", ip, limit: MAX_SESSIONS });
      client.end();
      return;
    }
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey") {
        const match = findAuthorizedKeyByPublicSSH(ctx.key.data);
        if (!match) {
          recordFailedAttempt(ip);
          auditLog({ event: "auth-fail", ip, method: "publickey" });
          return ctx.reject();
        }
        if (!ctx.signature) return ctx.accept();
        const ok = match.parsed.verify(ctx.blob, ctx.signature) === true;
        if (ok) {
          clearAttempts(ip);
          authedAs = {
            method: "publickey",
            identity: match.comment || match.fingerprint,
            fingerprint: match.fingerprint
          };
          auditLog({
            event: "auth-ok",
            ip,
            method: "publickey",
            fingerprint: match.fingerprint,
            user: match.comment || match.fingerprint
          });
          slog(
            "success",
            `[remote] authenticated: ${authedAs.identity} from ${ip}`
          );
          return ctx.accept();
        }
        recordFailedAttempt(ip);
        auditLog({ event: "auth-fail", ip, method: "publickey" });
        return ctx.reject();
      }
      return ctx.reject(["publickey"]);
    });
    client.on("ready", () => {
      client.on("request", (_accept, reject) => reject && reject());
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        let ptyCols = 80;
        let ptyRows = 24;
        let ptyTerm = "xterm-256color";
        let activeSession;
        session.on("pty", (acceptPty, _reject, info2) => {
          ptyCols = info2.cols;
          ptyRows = info2.rows;
          ptyTerm = info2.term ?? "xterm-256color";
          if (acceptPty) acceptPty();
        });
        session.on("window-change", (_accept, _reject, info2) => {
          activeSession?.child.resize(info2.cols, info2.rows);
        });
        session.on("shell", (acceptShell) => {
          const channel = acceptShell();
          const identity = authedAs?.identity ?? "unknown";
          const keyFingerprint = authedAs?.fingerprint ?? "unknown";
          const keySessions = sessionsByKey.get(keyFingerprint) ?? 0;
          if (keySessions >= MAX_SESSIONS_PER_KEY) {
            auditLog({
              event: "per-key-limit-reached",
              ip,
              fingerprint: keyFingerprint,
              limit: MAX_SESSIONS_PER_KEY
            });
            channel.stderr?.write(
              `Session limit reached for this key (max ${MAX_SESSIONS_PER_KEY}).
`
            );
            channel.exit(1);
            channel.end();
            return;
          }
          auditLog({ event: "shell-open", ip, ...authedAs });
          const child = spawnReplSession(ptyCols, ptyRows, ptyTerm, identity);
          const sess = {
            id: generateSessionId(),
            child,
            channel,
            ip,
            identity,
            keyFingerprint,
            connectedAt: /* @__PURE__ */ new Date(),
            sessionType: "shell",
            idleTimer: setTimeout(() => {
            }, 0)
            // placeholder; set properly below
          };
          registerSession(sess);
          resetIdleTimer(sess);
          slog(
            "info",
            `[remote] session opened \u2014 user: ${identity}  ip: ${ip}  active sessions: ${activeSessions.size}`
          );
          child.onData((data) => {
            channel.write(data);
            resetIdleTimer(sess);
          });
          channel.on("data", (data) => {
            child.write(data.toString("utf8"));
            resetIdleTimer(sess);
          });
          let childExited = false;
          child.onExit(({ exitCode }) => {
            childExited = true;
            unregisterSession(sess);
            channel.exit(exitCode);
            channel.end();
            auditLog({ event: "shell-close", ip, ...authedAs, exitCode });
            slog(
              "info",
              `[remote] session closed \u2014 user: ${identity}  ip: ${ip}  active sessions: ${activeSessions.size}`
            );
          });
          channel.on("close", () => {
            unregisterSession(sess);
            if (!childExited) {
              try {
                child.kill();
              } catch {
              }
            }
          });
          activeSession = sess;
        });
        session.on("exec", (acceptExec, rejectExec, info2) => {
          const args = tokeniseShell(info2.command);
          const identity = authedAs?.identity ?? "unknown";
          const keyFingerprint = authedAs?.fingerprint ?? "unknown";
          const BLOCKED_EXEC_COMMANDS = /* @__PURE__ */ new Set([
            "remote",
            "update",
            "install-service",
            "migrate-db"
          ]);
          const topLevelCmd = args[0];
          if (topLevelCmd && BLOCKED_EXEC_COMMANDS.has(topLevelCmd)) {
            const channel2 = acceptExec();
            auditLog({
              event: "exec-blocked",
              ip,
              ...authedAs,
              command: info2.command
            });
            channel2.stderr.write(
              `Command "${topLevelCmd}" is not allowed in a remote session.
`
            );
            channel2.exit(1);
            channel2.end();
            return;
          }
          const keySessions = sessionsByKey.get(keyFingerprint) ?? 0;
          if (keySessions >= MAX_SESSIONS_PER_KEY) {
            const channel2 = acceptExec();
            auditLog({
              event: "per-key-limit-reached",
              ip,
              fingerprint: keyFingerprint,
              limit: MAX_SESSIONS_PER_KEY
            });
            channel2.stderr.write(
              `Session limit reached for this key (max ${MAX_SESSIONS_PER_KEY}).
`
            );
            channel2.exit(1);
            channel2.end();
            return;
          }
          const channel = acceptExec();
          auditLog({ event: "exec", ip, ...authedAs, command: info2.command });
          const child = pty.spawn(
            process.execPath,
            [resolveDmEntrypoint(), ...args],
            {
              name: ptyTerm || "xterm-256color",
              cols: ptyCols || 80,
              rows: ptyRows || 24,
              cwd: ROOT_DIR,
              env: {
                ...process.env,
                DM_REMOTE_USER: identity
              }
            }
          );
          const sess = {
            id: generateSessionId(),
            child,
            channel,
            ip,
            identity,
            keyFingerprint,
            connectedAt: /* @__PURE__ */ new Date(),
            sessionType: "exec",
            idleTimer: setTimeout(() => {
            }, 0)
          };
          registerSession(sess);
          resetIdleTimer(sess);
          child.onData((data) => {
            channel.write(data);
            resetIdleTimer(sess);
          });
          channel.on("data", (data) => {
            child.write(data.toString("utf8"));
            resetIdleTimer(sess);
          });
          let execChildExited = false;
          child.onExit(({ exitCode }) => {
            execChildExited = true;
            unregisterSession(sess);
            channel.exit(exitCode);
            channel.end();
          });
          channel.on("close", () => {
            unregisterSession(sess);
            if (!execChildExited) {
              try {
                child.kill();
              } catch {
              }
            }
          });
          activeSession = sess;
        });
      });
    });
    client.on("close", () => {
      if (authedAs) {
        auditLog({ event: "disconnect", ip, ...authedAs });
        slog(
          "info",
          `[remote] disconnected \u2014 user: ${authedAs.identity}  ip: ${ip}`
        );
      } else {
        slog("info", `[remote] unauthenticated connection closed from ${ip}`);
      }
    });
    client.on("error", (err) => {
      slog("error", `[remote] client error (${ip}): ${err.message}`);
      const sessionsToCleanup = Array.from(activeSessions).filter(
        (s) => s.ip === ip
      );
      for (const s of sessionsToCleanup) {
        unregisterSession(s);
        try {
          s.child.kill();
        } catch {
        }
        try {
          s.channel.end();
        } catch {
        }
      }
    });
  });
  await new Promise((res, rej) => {
    server.listen(port, BIND_ADDRESS, res);
    server.on("error", rej);
  });
  const addr = server.address();
  slog("success", `dm remote server listening on ${BIND_ADDRESS}:${addr.port}`);
  if (BIND_ADDRESS !== "127.0.0.1" && BIND_ADDRESS !== "localhost") {
    slog(
      "warn",
      `WARNING: server is bound to ${BIND_ADDRESS} \u2014 reachable beyond localhost. Ensure firewall rules restrict access.`
    );
  }
  slog("info", `Host key fingerprint: ${fingerprint}`);
  slog(
    "info",
    "Share this fingerprint with anyone connecting for the first time."
  );
  slog(
    "info",
    `Max sessions: ${MAX_SESSIONS}  |  Idle timeout: ${IDLE_TIMEOUT_MS / 1e3}s`
  );
  serverEvents.emit("listening", BIND_ADDRESS, addr.port, fingerprint);
  await new Promise(() => {
  });
}
function tokeniseShell(command) {
  const tokens = [];
  let cur = "";
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
    if (ch === " " && !inSingle && !inDouble) {
      if (cur.length) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}
export {
  disconnectSession,
  generateSessionId,
  getActiveSessions,
  serverEvents,
  startRemoteServer
};
