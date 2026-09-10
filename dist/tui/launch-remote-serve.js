import { jsx } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { render, useApp } from "ink";
import fs from "fs";
import {
  startRemoteServer,
  serverEvents,
  getActiveSessions,
  disconnectSession
} from "../utils/ssh-server.js";
import { RemoteServeDashboard } from "./RemoteServeDashboard.js";
import { Logger } from "../utils/logger.js";
import { REMOTE_AUDIT_LOG_PATH } from "../constants.js";
const MAX_LOG = 200;
function App({
  serverInfo,
  initialLogs
}) {
  const { exit } = useApp();
  const [sessions, setSessions] = useState(
    () => getActiveSessions()
  );
  const [logs, setLogs] = useState(initialLogs);
  const addLog = useCallback((level, message) => {
    setLogs((prev) => {
      const next = [...prev, { level, message, ts: /* @__PURE__ */ new Date() }];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  }, []);
  useEffect(() => {
    const onLog = (level, message) => addLog(level, message);
    const onOpen = (_s) => setSessions(getActiveSessions());
    const onClose = (_id) => setSessions(getActiveSessions());
    serverEvents.on("log", onLog);
    serverEvents.on("session-open", onOpen);
    serverEvents.on("session-close", onClose);
    return () => {
      serverEvents.off("log", onLog);
      serverEvents.off("session-open", onOpen);
      serverEvents.off("session-close", onClose);
    };
  }, [addLog]);
  useEffect(() => {
    if (!fs.existsSync(REMOTE_AUDIT_LOG_PATH)) return;
    let offset = fs.statSync(REMOTE_AUDIT_LOG_PATH).size;
    const watcher = fs.watch(REMOTE_AUDIT_LOG_PATH, () => {
      try {
        const stat = fs.statSync(REMOTE_AUDIT_LOG_PATH);
        if (stat.size <= offset) return;
        const buf = Buffer.alloc(stat.size - offset);
        const fd = fs.openSync(REMOTE_AUDIT_LOG_PATH, "r");
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = stat.size;
        for (const rawLine of buf.toString("utf8").split("\n")) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.event === "repl-command") {
              addLog("info", `[${entry.identity}] $ ${entry.command}`);
            }
          } catch {
          }
        }
      } catch {
      }
    });
    return () => watcher.close();
  }, [addLog]);
  const handleDisconnect = useCallback((id) => {
    disconnectSession(id);
  }, []);
  const handleQuit = useCallback(() => {
    process.emit("SIGTERM");
    exit();
  }, [exit]);
  return /* @__PURE__ */ jsx(
    RemoteServeDashboard,
    {
      bindAddress: serverInfo.bindAddress,
      port: serverInfo.port,
      fingerprint: serverInfo.fingerprint,
      sessions,
      logs,
      onDisconnect: handleDisconnect,
      onQuit: handleQuit
    }
  );
}
async function launchRemoteServe(port) {
  const pendingLogs = [];
  const bufferLog = (level, message) => {
    pendingLogs.push({ level, message, ts: /* @__PURE__ */ new Date() });
  };
  serverEvents.on("log", bufferLog);
  Logger.isMuted = true;
  let resolveServerInfo;
  const serverInfoPromise = new Promise((res) => {
    resolveServerInfo = res;
  });
  serverEvents.once("listening", (address, actualPort, fingerprint) => {
    resolveServerInfo({ bindAddress: address, port: actualPort, fingerprint });
  });
  const serverPromise = startRemoteServer(port);
  const serverInfo = await serverInfoPromise;
  serverEvents.off("log", bufferLog);
  process.stdout.write("\x1B[?1049h");
  const { waitUntilExit } = render(
    /* @__PURE__ */ jsx(App, { serverInfo, initialLogs: pendingLogs })
  );
  await waitUntilExit();
  process.stdout.write("\x1B[?1049l");
  Logger.isMuted = false;
  await serverPromise.catch(() => {
  });
}
export {
  launchRemoteServe
};
