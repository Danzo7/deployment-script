import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dashboard } from './index.js';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';
import type { DashboardAction } from './types.js';
import type { GlobalState, AppDetail } from '../../../utils/dashboard-data.js';
import { listApps, fetchAppDetail } from '../../../utils/dashboard-data.js';
import { Logger } from '../../../utils/logger.js';

const FAST_POLL_MS = 2000;
const DETAIL_POLL_MS = 5000;
const GIT_FETCH_INTERVAL = 10;
const LOG_POLL_INTERVAL = 2;

export function DashboardAdapter(): React.ReactElement {
  const exit = usePageExit();

  const [globalState, setGlobalState] = useState<GlobalState | null>(null);
  const [appDetail, setAppDetail] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsTabActive, setLogsTabActive] = useState(false);
  const [selectedAppName, setSelectedAppName] = useState<string | null>(null);

  const detailTickRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);

  // Fast poll: global state
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await listApps(globalState);
        if (!cancelled) {
          setGlobalState(next);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          Logger.error(`Dashboard poll error: ${err.message}`);
        }
      }
    };

    // Initial poll
    poll();

    // Set up interval
    const interval = setInterval(poll, FAST_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [globalState]);

  // Detail poll: per-selected-app
  useEffect(() => {
    if (!selectedAppName || !globalState) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      const summary = globalState.summaries.find(
        (s) => s.app.name === selectedAppName
      );
      if (!summary) {
        setAppDetail(null);
        return;
      }

      detailTickRef.current += 1;
      const tick = detailTickRef.current;
      const doGitFetch = tick % GIT_FETCH_INTERVAL === 0;
      const doLogPoll = tick % LOG_POLL_INTERVAL === 0;

      // Cancel any in-flight detail fetch
      if (detailAbortRef.current) {
        detailAbortRef.current.abort();
      }
      const abortController = new AbortController();
      detailAbortRef.current = abortController;

      try {
        const detail = await fetchAppDetail(
          selectedAppName,
          summary,
          doGitFetch,
          doLogPoll,
          abortController.signal
        );
        if (!cancelled && !abortController.signal.aborted) {
          setAppDetail(detail);
        }
      } catch (err: any) {
        if (!cancelled && err?.message !== 'AbortError') {
          Logger.error(`Detail poll error: ${err.message}`);
        }
      }
    };

    // Initial poll
    poll();

    // Set up interval
    const interval = setInterval(poll, DETAIL_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (detailAbortRef.current) {
        detailAbortRef.current.abort();
        detailAbortRef.current = null;
      }
    };
  }, [selectedAppName, globalState]);

  // Load app logs when logs tab is active
  useEffect(() => {
    if (!logsTabActive || !selectedAppName) {
      setLogLines([]);
      return;
    }

    const loadLogs = async () => {
      try {
        const { readAppLogs } = await import('../../../utils/pm2-helper.js');
        const lines = await readAppLogs(selectedAppName);
        setLogLines(lines);
      } catch (err: any) {
        Logger.error(`Failed to load logs: ${err.message}`);
        setLogLines([]);
      }
    };

    loadLogs();
  }, [logsTabActive, selectedAppName]);

  const handleLogsTabActive = useCallback((active: boolean) => {
    setLogsTabActive(active);
  }, []);

  const handleSelectApp = useCallback((appName: string | null) => {
    setSelectedAppName(appName);
    setAppDetail(null);
    detailTickRef.current = 0;
  }, []);

  const handleAction = useCallback((action: DashboardAction) => {
    // Exit and return action to parent
    exit(action);
  }, [exit]);

  const handleClearLogs = useCallback(() => {
    setLogLines([]);
  }, []);

  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  return (
    <Dashboard
      globalState={globalState}
      appDetail={appDetail}
      loading={loading}
      logLines={logLines}
      onLogsTabActive={handleLogsTabActive}
      onSelectApp={handleSelectApp}
      onAction={handleAction}
      onClearLogs={handleClearLogs}
      onQuit={handleQuit}
    />
  );
}
