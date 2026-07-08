/**
 * Dashboard.tsx — layout shell + input handler.
 * All data concerns live in launch-dashboard.tsx.
 * All presentational concerns live in src/tui/components/.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

import type { GlobalState, AppDetail, AppSummary } from '../utils/dashboard-data.js';
import { TopBar } from './components/TopBar.js';
import { FilterBar } from './components/FilterBar.js';
import { AppList } from './components/AppList.js';
import { Keybar } from './components/Keybar.js';
import { CommandPalette, parsePaletteInput, getPaletteSuggestions } from './components/CommandPalette.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { CrashLoopToast } from './components/CrashLoopToast.js';
import { OverviewTab } from './components/tabs/OverviewTab.js';
import { MetricsTab } from './components/tabs/MetricsTab.js';
import { LogsTab } from './components/tabs/LogsTab.js';
import { DeploysTab } from './components/tabs/DeploysTab.js';
import { DomainsTab } from './components/tabs/DomainsTab.js';
import {
  TERM_W, LIST_W, DETAIL_W, DETAIL_H,
  statusColor, healthColor, truncate,
} from './components/shared.js';
import type { DetailTab, ActionMode } from './components/shared.js';

// Re-export shared types that launch-dashboard.tsx needs
export type { DetailTab, ActionMode };

// ─── Public contract ──────────────────────────────────────────────────────────

export interface DashboardAction {
  type: 'restart' | 'stop' | 'deploy' | 'rollback' | 'logs' | 'env' | 'view-nginx-config';
  appName: string;
  rollbackIndex?: number;
}

interface DashboardProps {
  globalState: GlobalState | null;
  /** Detail for the currently selected app — null while loading */
  appDetail: AppDetail | null;
  loading: boolean;
  logLines: string[];
  /** The name of the app the parent wants detail for (so it can fetch it) */
  onSelectApp: (appName: string | null) => void;
  onAction: (action: DashboardAction) => void;
  onClearLogs: () => void;
  onQuit: () => void;
}

// ─── TabBar (local, tiny) ─────────────────────────────────────────────────────

const TAB_KEYS: DetailTab[] = ['overview', 'metrics', 'logs', 'deploys', 'domains'];
const TAB_LABELS = ['Overview', 'Metrics', 'Logs', 'Deploys', 'Domains'];

function TabBar({ active }: { active: DetailTab }): React.ReactElement {
  const texts = TAB_LABELS.map((l) => ` ${l} `);
  const fill = Math.max(0, DETAIL_W - texts.reduce((s, t) => s + t.length, 0));
  return (
    <Box flexDirection="row" width={DETAIL_W}>
      {TAB_KEYS.map((k, i) =>
        k === active
          ? <Box key={k}><Text bold color="yellow">{texts[i]!}</Text></Box>
          : <Box key={k}><Text dimColor>{texts[i]!}</Text></Box>
      )}
      {fill > 0 && <Text dimColor>{'─'.repeat(fill)}</Text>}
    </Box>
  );
}

// ─── DetailHeader (local, tiny) ───────────────────────────────────────────────

function DetailHeader({ summary }: { summary: AppSummary | null }): React.ReactElement {
  if (!summary) return <Box width={DETAIL_W}><Text dimColor>Select an app…</Text></Box>;
  const status = summary.pm2?.status ?? 'not-found';
  const hColor = healthColor(summary.health);
  const badge = ({ healthy: '[HEALTHY]', degraded: '[DEGRADED]', down: '[DOWN]' } as Record<string, string>)[summary.health] ?? '[UNKNOWN]';
  return (
    <Box flexDirection="row" justifyContent="space-between" width={DETAIL_W}>
      <Box flexDirection="row" gap={1}>
        <Text bold color="white">{truncate(summary.app.name, Math.floor(DETAIL_W * 0.5))}</Text>
        <Text color={statusColor(status)}>{status}</Text>
      </Box>
      <Text color={hColor}>{badge}</Text>
    </Box>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard(props: DashboardProps): React.ReactElement {
  const { exit } = useApp();

  const [cursor, setCursor] = useState(0);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [cmdInput, setCmdInput] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [deployCursor, setDeployCursor] = useState(0);
  const [toastAppName, setToastAppName] = useState<string | null>(null);
  const [toastTick, setToastTick] = useState(0);
  const [tabScrollOffset, setTabScrollOffset] = useState(0);

  const cpuHistories = useRef<Map<string, number[]>>(new Map());
  const memHistories = useRef<Map<string, number[]>>(new Map());

  const summaries = props.globalState?.summaries ?? [];
  const filteredSummaries = filterQuery.trim()
    ? summaries.filter((s) => s.app.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : summaries;
  const selectedSummary = filteredSummaries[cursor] ?? null;
  const appNames = summaries.map((s) => s.app.name);

  // Notify parent which app is selected so it can fetch detail
  const prevSelectedName = useRef<string | null>(null);
  useEffect(() => {
    const name = selectedSummary?.app.name ?? null;
    if (name !== prevSelectedName.current) {
      prevSelectedName.current = name;
      props.onSelectApp(name);
    }
  }, [selectedSummary?.app.name]);

  // Sparkline history — update on every global tick
  useEffect(() => {
    for (const s of summaries) {
      const name = s.app.name;
      const cpu = s.pm2?.cpu ?? 0;
      const mem = s.pm2?.memBytes ?? 0;
      cpuHistories.current.set(name, [...(cpuHistories.current.get(name) ?? []), cpu].slice(-30));
      memHistories.current.set(name, [...(memHistories.current.get(name) ?? []), mem / 1024 / 1024].slice(-30));
    }
  }, [props.globalState?.tickCount]);

  // Cursor bounds
  useEffect(() => {
    if (cursor >= filteredSummaries.length && filteredSummaries.length > 0) {
      setCursor(filteredSummaries.length - 1);
    }
  }, [filteredSummaries.length]);

  // Reset scroll and deploy cursor when selection/tab changes
  useEffect(() => { setDeployCursor(0); }, [selectedSummary?.app.name]);
  useEffect(() => { setTabScrollOffset(0); }, [tab, selectedSummary?.app.name]);

  // Crash-loop toast
  useEffect(() => {
    if (!toastAppName) {
      const looping = summaries.find((s) => s.restartDelta >= 3);
      if (looping) { setToastAppName(looping.app.name); setToastTick(0); }
    }
    if (toastAppName) setToastTick((t) => t + 1);
  }, [props.globalState?.tickCount]);

  const TABS = TAB_KEYS;

  useInput((input, key) => {
    if (toastAppName && key.escape) { setToastAppName(null); setToastTick(0); return; }

    if (actionMode === 'cmd-palette') {
      if (key.escape) { setActionMode('none'); setCmdInput(''); }
      else if (key.tab) setCmdInput(getPaletteSuggestions(cmdInput, appNames)[0] ?? cmdInput);
      else if (key.return) {
        const p = parsePaletteInput(cmdInput, appNames);
        if (p) props.onAction(p);
        setActionMode('none'); setCmdInput('');
      } else if (key.backspace || key.delete) setCmdInput((s) => s.slice(0, -1));
      else if (input.length === 1 && input >= ' ') setCmdInput((s) => s + input);
      return;
    }

    if (actionMode === 'confirm-restart' || actionMode === 'confirm-stop' || actionMode === 'confirm-rollback') {
      if (input === 'y' || key.return) {
        if (selectedSummary) {
          if (actionMode === 'confirm-restart') props.onAction({ type: 'restart', appName: selectedSummary.app.name });
          else if (actionMode === 'confirm-stop') props.onAction({ type: 'stop', appName: selectedSummary.app.name });
          else if (actionMode === 'confirm-rollback') {
            const activeIdx = selectedSummary.app.builds?.findIndex((b) => b === selectedSummary.app.activeBuild) ?? -1;
            if (deployCursor !== activeIdx) props.onAction({ type: 'rollback', appName: selectedSummary.app.name, rollbackIndex: deployCursor });
          }
        }
        setActionMode('none');
      } else if (input === 'n' || key.escape) setActionMode('none');
      return;
    }

    if (filterActive) {
      if (key.escape) { setFilterQuery(''); setFilterActive(false); }
      else if (key.backspace || key.delete) setFilterQuery((s) => s.slice(0, -1));
      else if (input.length === 1 && input >= ' ') setFilterQuery((s) => s + input);
      return;
    }

    if (input === '/') { if (tab !== 'logs') setFilterActive(true); }
    else if (input === ':') setActionMode('cmd-palette');
    else if (input === 'q') { props.onQuit(); exit(); }
    else if (key.upArrow || input === 'k') {
      if (tab === 'deploys') setDeployCursor((d) => Math.max(0, d - 1));
      else setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === 'j') {
      if (tab === 'deploys') setDeployCursor((d) => Math.min((selectedSummary?.app.builds?.length ?? 1) - 1, d + 1));
      else setCursor((c) => Math.min(filteredSummaries.length - 1, c + 1));
    } else if (key.tab || input === 'l') { setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length]); setTabScrollOffset(0); }
    else if (input === 'h') { setTab((t) => TABS[(TABS.indexOf(t) - 1 + TABS.length) % TABS.length]); setTabScrollOffset(0); }
    else if (key.pageUp) setTabScrollOffset((o) => o + Math.max(1, Math.floor(DETAIL_H / 2)));
    else if (key.pageDown) setTabScrollOffset((o) => Math.max(0, o - Math.max(1, Math.floor(DETAIL_H / 2))));
    else if (input === 'r') { if (selectedSummary) setActionMode('confirm-restart'); }
    else if (input === 'S') { if (selectedSummary) setActionMode('confirm-stop'); }
    else if (input === 'D') { if (selectedSummary) props.onAction({ type: 'deploy', appName: selectedSummary.app.name }); }
    else if (input === 'E') { if (selectedSummary) props.onAction({ type: 'env', appName: selectedSummary.app.name }); }
    else if (input === 'L') { if (selectedSummary) props.onAction({ type: 'logs', appName: selectedSummary.app.name }); }
    else if (input === 'X' && tab === 'logs') props.onClearLogs();
    else if (key.return && tab === 'deploys') {
      if (selectedSummary) {
        const activeIdx = selectedSummary.app.builds?.findIndex((b) => b === selectedSummary.app.activeBuild) ?? -1;
        if (deployCursor !== activeIdx) setActionMode('confirm-rollback');
      }
    } else if (key.return && tab === 'domains') {
      if (selectedSummary) props.onAction({ type: 'view-nginx-config', appName: selectedSummary.app.name });
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (props.loading || !props.globalState) {
    return (
      <Box flexDirection="column" width={TERM_W}>
        <Text dimColor>Loading…</Text>
      </Box>
    );
  }

  const { pm2Reachable, dbReachable, sshReachable, sshHost, totalMemBytes } = props.globalState;
  const cpuHistory = cpuHistories.current.get(selectedSummary?.app.name ?? '') ?? [];
  const memHistory = memHistories.current.get(selectedSummary?.app.name ?? '') ?? [];

  const overlayActive = actionMode !== 'none';

  return (
    <Box flexDirection="column" width={TERM_W}>
      <TopBar pm2Reachable={pm2Reachable} dbReachable={dbReachable} sshReachable={sshReachable} sshHost={sshHost} />
      <FilterBar active={filterActive} query={filterQuery} />

      {/* Crash loop toast */}
      {toastAppName && (
        <CrashLoopToast
          appName={toastAppName}
          restartCount={summaries.find((s) => s.app.name === toastAppName)?.restartDelta ?? 0}
          tickCount={toastTick}
          onDismiss={() => { setToastAppName(null); setToastTick(0); }}
        />
      )}

      {/* Main two-column layout */}
      <Box flexDirection="row" width={TERM_W}>
        {/* Left: app list */}
        <Box flexDirection="column" width={LIST_W}>
          <AppList summaries={filteredSummaries} cursor={cursor} />
        </Box>

        {/* Divider */}
        <Box flexDirection="column" width={1}>
          <Text dimColor>│</Text>
        </Box>

        {/* Right: detail pane */}
        <Box flexDirection="column" width={DETAIL_W}>
          {selectedSummary ? (
            <>
              <DetailHeader summary={selectedSummary} />
              <TabBar active={tab} />
              {tab === 'overview' && (
                <OverviewTab summary={selectedSummary} detail={props.appDetail} />
              )}
              {tab === 'metrics' && (
                <MetricsTab
                  summary={selectedSummary}
                  detail={props.appDetail}
                  cpuHistory={cpuHistory}
                  memHistory={memHistory}
                  totalMemBytes={totalMemBytes}
                  scrollOffset={tabScrollOffset}
                  maxVisible={DETAIL_H}
                />
              )}
              {tab === 'logs' && (
                <LogsTab logLines={props.logLines} scrollOffset={tabScrollOffset} maxVisible={DETAIL_H} />
              )}
              {tab === 'deploys' && (
                <DeploysTab
                  summary={selectedSummary}
                  deployCursor={deployCursor}
                  onAction={props.onAction}
                  scrollOffset={tabScrollOffset}
                  maxVisible={DETAIL_H}
                />
              )}
              {tab === 'domains' && (
                <DomainsTab detail={props.appDetail} maxVisible={DETAIL_H} />
              )}
            </>
          ) : (
            <Box width={DETAIL_W} height={DETAIL_H}>
              <Text dimColor>No apps found.</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Keybar activeTab={tab} />

      {/* Overlays */}
      {overlayActive && (
        <Box flexDirection="column" alignItems="center" width={TERM_W} marginTop={1}>
          {actionMode === 'cmd-palette' && (
            <CommandPalette input={cmdInput} appNames={appNames} />
          )}
          {actionMode === 'confirm-restart' && selectedSummary && (
            <ConfirmDialog title="Restart app" description={`Restart ${selectedSummary.app.name}?`} />
          )}
          {actionMode === 'confirm-stop' && selectedSummary && (
            <ConfirmDialog title="Stop app" description={`Stop ${selectedSummary.app.name}?`} />
          )}
          {actionMode === 'confirm-rollback' && selectedSummary && (
            <ConfirmDialog title="Rollback" description={`Roll back ${selectedSummary.app.name} to build ${deployCursor}?`} />
          )}
        </Box>
      )}
    </Box>
  );
}
