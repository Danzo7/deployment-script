import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, useApp } from 'ink';
import { subscribeBus, readRecentLogs, openSharedPm2, closeSharedPm2 } from '../utils/pm2-helper.js';
import { Dashboard } from './Dashboard.js';
import type { DashboardAction } from './Dashboard.js';
import {
  listApps,
  fetchAppDetail,
  disconnectSharedSsh,
  resetTailers,
  GlobalState,
  AppDetail,
  AppSummary,
} from '../utils/dashboard-data.js';
import { Logger } from '../utils/logger.js';
import { pauseRepl, resumeRepl } from '../utils/repl-context.js';

// ─── Polling cadences ─────────────────────────────────────────────────────────
const LIST_POLL_MS    = 2_000;   // sidebar: app list + PM2 status
const DETAIL_POLL_MS  = 5_000;   // detail pane: port, drift, nginx logs
const GIT_FETCH_EVERY = 12;      // every 12 detail ticks ≈ 60 s
const LOG_POLL_EVERY  = 2;       // every 2 detail ticks ≈ 10 s

function DashboardApp(): React.ReactElement {
  const { exit } = useApp();

  const [globalState, setGlobalState]   = useState<GlobalState | null>(null);
  const [appDetail, setAppDetail]       = useState<AppDetail | null>(null);
  const [loading, setLoading]           = useState(true);
  const [logLines, setLogLines]         = useState<string[]>([]);

  // Which app name the Dashboard is currently showing — set via onSelectApp callback
  const selectedAppName = useRef<string | null>(null);
  // Track the last app name we fetched detail for so we can invalidate immediately on switch
  const lastDetailAppName = useRef<string | null>(null);

  const detailTickRef = useRef(0);

  const addLog = useCallback((line: string) => {
    setLogLines((prev) => {
      const next = [...prev, line];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  // Load existing PM2 log file on mount
  useEffect(() => {
    readRecentLogs(300).then((lines) => {
      if (lines.length > 0) setLogLines(lines);
    }).catch(() => {});
  }, []);

  // PM2 bus — push-based log/event stream
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    subscribeBus((packet) => {
      if (cancelled) return;
      const name = packet.process?.name ?? '';
      if (packet.event === 'log:out') addLog(`[${name}] ${String(packet.data).trim()}`);
      else if (packet.event === 'log:err') addLog(`[${name}][err] ${String(packet.data).trim()}`);
      else if (packet.event === 'process:event') addLog(`[${name}] ← PM2: ${packet.data ?? ''}`);
    }).then((c) => {
      if (cancelled) { c(); return; }
      cleanup = c;
    }).catch(() => {});

    return () => { cancelled = true; cleanup?.(); };
  }, []);

  // ── Fast loop: sidebar list (every 2 s) ───────────────────────────────────
  useEffect(() => {
    let alive = true;
    let timer: NodeJS.Timeout;

    const tick = async () => {
      try {
        const next = await listApps(globalState);
        if (alive) {
          setGlobalState(next);
          setLoading(false);
        }
      } catch { /* keep showing last state */ }

      if (alive) timer = setTimeout(tick, LIST_POLL_MS);
    };

    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // ── Slow loop: per-selected-app detail (every 5 s) ────────────────────────
  useEffect(() => {
    let alive = true;
    let timer: NodeJS.Timeout;

    const tick = async () => {
      const appName = selectedAppName.current;

      if (!appName || !globalState) {
        if (alive) timer = setTimeout(tick, DETAIL_POLL_MS);
        return;
      }

      // Find the summary for this app from the latest global state
      const summary: AppSummary | undefined = globalState.summaries.find(
        (s) => s.app.name === appName
      );

      if (!summary) {
        if (alive) timer = setTimeout(tick, DETAIL_POLL_MS);
        return;
      }

      detailTickRef.current += 1;
      const n = detailTickRef.current;
      const doGitFetch = n % GIT_FETCH_EVERY === 1;
      const doLogPoll  = n % LOG_POLL_EVERY  === 0;

      try {
        const detail = await fetchAppDetail(appName, summary, doGitFetch, doLogPoll);
        if (alive) setAppDetail(detail);
      } catch { /* keep last detail */ }

      if (alive) timer = setTimeout(tick, DETAIL_POLL_MS);
    };

    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const handleSelectApp = useCallback((appName: string | null) => {
    if (appName !== lastDetailAppName.current) {
      // Clear stale detail immediately when switching apps
      setAppDetail(null);
      lastDetailAppName.current = appName;
      detailTickRef.current = 0; // reset so next tick does a git fetch + log seed
    }
    selectedAppName.current = appName;
  }, []);

  const handleQuit = useCallback(() => {
    closeSharedPm2();
    disconnectSharedSsh();
    resetTailers();
  }, []);

  const handleClearLogs = useCallback(() => setLogLines([]), []);

  const handleAction = useCallback((action: DashboardAction) => {
    (globalThis as any).__pendingDashboardAction = action;
    exit();
  }, [exit]);

  return (
    <Dashboard
      globalState={globalState}
      appDetail={appDetail}
      loading={loading}
      logLines={logLines}
      onSelectApp={handleSelectApp}
      onAction={handleAction}
      onClearLogs={handleClearLogs}
      onQuit={handleQuit}
    />
  );
}

// ─── Exported launcher ────────────────────────────────────────────────────────

export async function launchDashboard(): Promise<void> {
  pauseRepl();
  Logger.isMuted = true;

  try { await openSharedPm2(); } catch { /* dashboard will show pm2 unreachable */ }

  (globalThis as any).__pendingDashboardAction = undefined;

  const { waitUntilExit } = render(<DashboardApp />);
  await waitUntilExit();

  closeSharedPm2();
  resumeRepl();
  Logger.isMuted = false;

  const action: DashboardAction | undefined = (globalThis as any).__pendingDashboardAction;
  if (!action) return;

  console.log();

  switch (action.type) {
    case 'restart': {
      const { restart } = await import('../commands/restart.js');
      await restart({ name: action.appName });
      break;
    }
    case 'stop': {
      const { stop } = await import('../commands/stop.js');
      await stop({ name: action.appName });
      break;
    }
    case 'deploy': {
      Logger.info(`To deploy: dm deploy ${action.appName}`);
      break;
    }
    case 'rollback': {
      const { rollback } = await import('../commands/rollback.js');
      await rollback({ name: action.appName, to: action.rollbackIndex });
      break;
    }
    case 'logs': {
      const { logs } = await import('../commands/logs.js');
      await logs({ name: action.appName });
      await new Promise(() => {});
      break;
    }
    case 'env': {
      const { launchEnvEditor } = await import('./launch-env-editor.js');
      await launchEnvEditor(action.appName);
      break;
    }
    default:
      break;
  }
}
