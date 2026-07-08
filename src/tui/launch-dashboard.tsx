import { useState, useEffect, useRef, useCallback } from 'react';
import { render, useApp } from 'ink';
import { subscribeBus, readRecentLogs, openSharedPm2, closeSharedPm2 } from '../utils/pm2-helper.js';
import { Dashboard, DashboardAction } from './Dashboard.js';
import {
  refreshDashboard,
  disconnectSharedSsh,
  resetTailers,
  DashboardState,
} from '../utils/dashboard-data.js';
import { Logger } from '../utils/logger.js';
import { pauseRepl, resumeRepl } from '../utils/repl-context.js';

// ─── Polling cadences ─────────────────────────────────────────────────────────
const PM2_POLL_MS = 2_000;          // PM2 metrics (fast)
const LOG_POLL_TICKS = 5;           // every 5 PM2 ticks → ~10s
const GIT_FETCH_TICKS = 30;         // every 30 ticks → ~60s

function DashboardApp() {
  const { exit } = useApp();
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [logLines, setLogLines] = useState<string[]>([]);

  const tickRef = useRef(0);

  const addLog = useCallback((line: string) => {
    setLogLines((prev) => {
      const next = [...prev, line];
      // Cap at 500 lines
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  // Load existing log file contents on mount
  useEffect(() => {
    readRecentLogs(300).then((lines) => {
      if (lines.length > 0) setLogLines(lines);
    }).catch(() => {});
  }, []);

  // Subscribe to PM2 bus for push-based log/event notifications
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    subscribeBus(
      (packet) => {
        if (cancelled) return;
        const name = packet.process?.name ?? '';
        if (packet.event === 'log:out') {
          addLog(`[${name}] ${String(packet.data).trim()}`);
        } else if (packet.event === 'log:err') {
          addLog(`[${name}][err] ${String(packet.data).trim()}`);
        } else if (packet.event === 'process:event') {
          addLog(`[${name}] ← PM2: ${packet.data ?? ''}`);
        }
      },
    ).then((c) => {
      if (cancelled) { c(); return; }
      cleanup = c;
    }).catch(() => { /* PM2 bus unavailable — polling covers status */ });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Polling loop
  useEffect(() => {
    let alive = true;
    let timer: NodeJS.Timeout;

    const tick = async () => {
      tickRef.current += 1;
      const n = tickRef.current;
      const doGitFetch = n % GIT_FETCH_TICKS === 1;
      const doLogPoll = n % LOG_POLL_TICKS === 0;

      try {
        const next = await refreshDashboard(
          state,
          doGitFetch,
          doLogPoll,
        );
        if (alive) {
          setState(next);
          setLoading(false);
        }
      } catch {
        // Don't crash the TUI on a refresh error; just wait for next tick
      }

      if (alive) {
        timer = setTimeout(tick, PM2_POLL_MS);
      }
    };

    tick();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  const handleQuit = useCallback(() => {
    closeSharedPm2();
    disconnectSharedSsh();
    resetTailers();
  }, []);

  const handleClearLogs = useCallback(() => {
    setLogLines([]);
  }, []);

  const handleAction = useCallback((action: DashboardAction) => {
    // Actions that exit the TUI and hand off to CLI commands
    // The launcher (launchDashboard) will re-run the command after exit
    (globalThis as any).__pendingDashboardAction = action;
    exit();
  }, [exit]);

  return (
    <Dashboard
      state={state}
      loading={loading}
      logLines={logLines}
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

  // Open persistent PM2 connection — shared by bus subscription and polling
  try { await openSharedPm2(); } catch { /* dashboard will show pm2 unreachable */ }

  // Clear any pending action from previous run
  (globalThis as any).__pendingDashboardAction = undefined;

  const { waitUntilExit } = render(<DashboardApp />);
  await waitUntilExit();

  closeSharedPm2();
  resumeRepl();

  Logger.isMuted = false;

  // Handle any action the user triggered from the dashboard
  const action: DashboardAction | undefined = (globalThis as any).__pendingDashboardAction;
  if (!action) return;

  console.log(); // spacing after TUI

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
      // keep alive — logs streams until Ctrl+C
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
