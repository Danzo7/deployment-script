import { jsx } from "react/jsx-runtime";
import { useState, useEffect, useRef, useCallback } from "react";
import { render, useApp } from "ink";
import {
  subscribeBus,
  readAppLogs,
  openSharedPm2,
  closeSharedPm2
} from "../utils/pm2-helper.js";
import { Dashboard } from "./Dashboard.js";
import {
  listApps,
  fetchAppDetail,
  disconnectSharedSsh,
  resetTailers
} from "../utils/dashboard-data.js";
import { Logger } from "../utils/logger.js";
import { pauseRepl, resumeRepl } from "../utils/repl-context.js";
const LIST_POLL_MS = 2e3;
const DETAIL_POLL_MS = 5e3;
const GIT_FETCH_EVERY = 12;
const LOG_POLL_EVERY = 2;
const MAX_LOG_LINES = 500;
function DashboardApp() {
  const { exit } = useApp();
  const [globalState, setGlobalState] = useState(null);
  const [appDetail, setAppDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logLines, setLogLines] = useState([]);
  const selectedAppName = useRef(null);
  const lastDetailAppName = useRef(null);
  const globalStateRef = useRef(null);
  const detailTickRef = useRef(0);
  const currentAbortController = useRef(null);
  useEffect(() => {
    let cleanup = null;
    let cancelled = false;
    subscribeBus((packet) => {
      if (cancelled) return;
      const name = packet.process?.name ?? "";
      if (name !== selectedAppName.current) return;
      const newLines = [];
      if (packet.event === "log:out") {
        const raw = String(packet.data ?? "");
        for (const l of raw.split("\n")) {
          const t = l.trim();
          if (t) newLines.push(`[${name}] ${t}`);
        }
      } else if (packet.event === "log:err") {
        const raw = String(packet.data ?? "");
        for (const l of raw.split("\n")) {
          const t = l.trim();
          if (t) newLines.push(`[${name}][err] ${t}`);
        }
      } else if (packet.event === "process:event") {
        newLines.push(`[${name}] \u2190 PM2: ${packet.data ?? ""}`);
      }
      if (newLines.length > 0) {
        setLogLines((prev) => {
          const next = [...prev, ...newLines];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      }
    }).then((c) => {
      if (cancelled) {
        c();
        return;
      }
      cleanup = c;
    }).catch(() => {
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const next = await listApps(globalStateRef.current);
        if (alive) {
          globalStateRef.current = next;
          setGlobalState(next);
          setLoading(false);
        }
      } catch {
      }
      if (alive) timer = setTimeout(tick, LIST_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      const appName = selectedAppName.current;
      const gs = globalStateRef.current;
      if (!appName || !gs) {
        if (alive) timer = setTimeout(tick, DETAIL_POLL_MS);
        return;
      }
      const summary = gs.summaries.find(
        (s) => s.app.name === appName
      );
      if (!summary) {
        if (alive) timer = setTimeout(tick, DETAIL_POLL_MS);
        return;
      }
      if (currentAbortController.current) {
        currentAbortController.current.abort();
      }
      detailTickRef.current += 1;
      const n = detailTickRef.current;
      const doGitFetch = n % GIT_FETCH_EVERY === 1;
      const doLogPoll = n % LOG_POLL_EVERY === 0;
      currentAbortController.current = new AbortController();
      const signal = currentAbortController.current.signal;
      try {
        const detail = await fetchAppDetail(
          appName,
          summary,
          doGitFetch,
          doLogPoll,
          signal
        );
        if (alive && !signal.aborted) setAppDetail(detail);
      } catch (err) {
        if (err.name !== "AbortError") {
        }
      } finally {
        if (currentAbortController.current?.signal === signal) {
          currentAbortController.current = null;
        }
      }
      if (alive) timer = setTimeout(tick, DETAIL_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      currentAbortController.current?.abort();
    };
  }, []);
  const handleSelectApp = useCallback((appName) => {
    if (appName === lastDetailAppName.current) {
      selectedAppName.current = appName;
      return;
    }
    if (currentAbortController.current) {
      currentAbortController.current.abort();
      currentAbortController.current = null;
    }
    setAppDetail(null);
    setLogLines([]);
    lastDetailAppName.current = appName;
    detailTickRef.current = 0;
    selectedAppName.current = appName;
    if (appName) {
      readAppLogs(appName, 300).then((lines) => {
        if (selectedAppName.current === appName) {
          setLogLines(lines);
        }
      }).catch(() => {
      });
    }
  }, []);
  const handleLogsTabActive = useCallback((active) => {
    if (active) {
      const appName = selectedAppName.current;
      if (appName) {
        setLogLines((prev) => {
          if (prev.length > 0) return prev;
          readAppLogs(appName, 300).then((lines) => {
            if (selectedAppName.current === appName) {
              setLogLines((cur) => cur.length === 0 ? lines : cur);
            }
          }).catch(() => {
          });
          return prev;
        });
      }
    }
  }, []);
  const handleClearLogs = useCallback(() => setLogLines([]), []);
  const handleQuit = useCallback(() => {
    closeSharedPm2();
    disconnectSharedSsh();
    resetTailers();
  }, []);
  const handleAction = useCallback(
    (action) => {
      globalThis.__pendingDashboardAction = action;
      exit();
    },
    [exit]
  );
  return /* @__PURE__ */ jsx(
    Dashboard,
    {
      globalState,
      appDetail,
      loading,
      logLines,
      onSelectApp: handleSelectApp,
      onLogsTabActive: handleLogsTabActive,
      onAction: handleAction,
      onClearLogs: handleClearLogs,
      onQuit: handleQuit
    }
  );
}
async function launchDashboard() {
  pauseRepl();
  Logger.isMuted = true;
  try {
    await openSharedPm2();
  } catch {
  }
  globalThis.__pendingDashboardAction = void 0;
  process.stdout.write("\x1B[?1049h");
  const { waitUntilExit } = render(/* @__PURE__ */ jsx(DashboardApp, {}));
  await waitUntilExit();
  process.stdout.write("\x1B[?1049l");
  closeSharedPm2();
  resumeRepl();
  Logger.isMuted = false;
  const action = globalThis.__pendingDashboardAction;
  if (!action) return;
  console.log();
  switch (action.type) {
    case "restart": {
      const { restart } = await import("../commands/restart.js");
      await restart({ name: action.appName });
      break;
    }
    case "stop": {
      const { stop } = await import("../commands/stop.js");
      await stop({ name: action.appName });
      break;
    }
    case "deploy": {
      Logger.info(`To deploy: dm deploy ${action.appName}`);
      break;
    }
    case "rollback": {
      const { rollback } = await import("../commands/rollback.js");
      await rollback({ name: action.appName, to: action.rollbackIndex });
      break;
    }
    case "logs": {
      const { logs } = await import("../commands/logs.js");
      await logs({ name: action.appName });
      await new Promise(() => {
      });
      break;
    }
    case "env": {
      const { launchEnvEditor } = await import("./launch-env-editor.js");
      await launchEnvEditor(action.appName);
      break;
    }
    default:
      break;
  }
}
export {
  launchDashboard
};
