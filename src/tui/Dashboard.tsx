/**
 * Dashboard.tsx — TUI dashboard for dm (deployment-manager)
 *
 * Full rewrite aligned with the amber-accented design reference.
 * Data-fetching, PM2 subscriptions, and action dispatch live in
 * launch-dashboard.tsx; this file is the pure presentational layer.
 *
 * Task 1 of N — Foundation: types, constants, helpers, sparkline.
 * Components are added in subsequent tasks.
 */
import React, {
  useState,
  useEffect,
  useRef,
} from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { DashboardState, AppData, DomainInfo } from '../utils/dashboard-data.js';

// ─── Public contract (unchanged — consumed by launch-dashboard.tsx) ───────────

export interface DashboardAction {
  type: 'restart' | 'stop' | 'deploy' | 'rollback' | 'logs' | 'env' | 'view-nginx-config';
  appName: string;
  rollbackIndex?: number;
}

interface DashboardProps {
  state: DashboardState | null;
  loading: boolean;
  /** PM2 bus log lines captured by launch-dashboard.tsx */
  logLines: string[];
  onAction: (action: DashboardAction) => void;
  onQuit: () => void;
}

// ─── Internal types ───────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'metrics' | 'logs' | 'deploys' | 'domains';

type ActionMode = 'none' | 'confirm-restart' | 'confirm-stop' | 'confirm-rollback' | 'cmd-palette';

// ─── Layout constants ─────────────────────────────────────────────────────────

const TERM_W = Math.max(process.stdout.columns ?? 120, 80);
const TERM_H = Math.max(process.stdout.rows ?? 30, 20);
const LIST_W = Math.max(20, Math.min(32, Math.floor(TERM_W * 0.28)));
const DETAIL_W = TERM_W - LIST_W - 3; // 3 for border/gap chars
const TOAST_TTL_TICKS = 10;

// ─── Colour-semantic helpers ──────────────────────────────────────────────────
//
// Amber  = 'yellow' + bold — ONLY for selection, active tab, focused input,
//          brand label "dm". Never used for status.
// Green  = online / healthy
// Red    = errored / down
// Yellow (non-bold) = stopped / degraded / warning

/** Returns the Ink colour string for a PM2 process status. */
function statusColor(status: string): string {
  switch (status) {
    case 'online':    return 'green';
    case 'errored':
    case 'error':     return 'red';
    case 'stopped':
    case 'stopping':  return 'yellow';
    default:          return 'gray';
  }
}

/** Returns a coloured '●' dot character for the given PM2 status. */
function statusDot(status: string): string {
  // Always returns '●'; callers apply colour via <Text color={statusColor(status)}>.
  void statusColor(status);
  return '●';
}

/** Returns the Ink colour string for an app health value. */
function healthColor(health: AppData['health']): string {
  switch (health) {
    case 'healthy':  return 'green';
    case 'degraded': return 'yellow';
    case 'down':     return 'red';
    default:         return 'gray';
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Formats a byte count to a human-readable memory string (e.g. "123.4 MB"). */
function fmtMem(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/** Formats a millisecond uptime duration to a concise string (e.g. "2d 3h", "5h 12m"). */
function fmtUptime(ms: number): string {
  if (!ms || ms < 0) return '-';
  const totalSec = Math.floor(ms / 1000);
  const days    = Math.floor(totalSec / 86400);
  const hours   = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const secs    = totalSec % 60;
  if (days > 0)    return `${days}d ${hours}h`;
  if (hours > 0)   return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** Returns a relative timestamp string for a Date (e.g. "2h ago", "3d ago", "just now"). */
function fmtDate(date?: Date): string {
  if (!date) return 'never';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60)  return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Truncates a string to at most maxLen characters, appending '…' when truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen <= 1) return '…';
  return str.slice(0, maxLen - 1) + '…';
}

/** Pads (or truncates) a string to exactly len characters using trailing spaces. */
function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

/** Unicode block characters for sparkline rendering (space + 8 levels). */
const SPARK_CHARS = ' ▁▂▃▄▅▆▇█'; // 9 chars: index 0 = space (empty), 8 = full block

/**
 * Maps an array of numeric values to a sparkline string of the given width.
 *
 * - Uses the last `width` samples (or pads with zeros on the left when shorter).
 * - Scales values relative to the maximum in the window; max-normalised.
 * - Width defaults to 10.
 */
function sparkline(values: number[], width = 10): string {
  if (width <= 0) return '';
  if (!values.length) return ' '.repeat(width);

  const max = Math.max(...values, 1); // guard division by zero
  const slice = values.slice(-width);
  const padded =
    slice.length < width
      ? [...Array(width - slice.length).fill(0), ...slice]
      : slice;

  return padded
    .map((v) => {
      const idx = Math.min(
        Math.floor((v / max) * (SPARK_CHARS.length - 1)),
        SPARK_CHARS.length - 1,
      );
      return SPARK_CHARS[idx];
    })
    .join('');
}

// ─── Exports (for use in sub-components added in later tasks) ─────────────────

export type { DetailTab, ActionMode };
export {
  TERM_W,
  TERM_H,
  LIST_W,
  DETAIL_W,
  TOAST_TTL_TICKS,
  statusColor,
  statusDot,
  healthColor,
  fmtMem,
  fmtUptime,
  fmtDate,
  truncate,
  pad,
  sparkline,
  SPARK_CHARS,
};

// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  pm2Reachable: boolean;
  dbReachable: boolean;
  sshReachable?: boolean;
  sshHost?: string;
}

/**
 * Single-line strip at the very top of the Dashboard.
 * Left: brand "dm" in amber, connection dots (pm2, db, optional ssh).
 * Right: wall-clock time HH:MM:SS, updated every second.
 * Followed by a horizontal separator line.
 *
 * Requirements: 2.1–2.7
 */
export function TopBar({ pm2Reachable, dbReachable, sshReachable, sshHost }: TopBarProps): React.ReactElement {
  const [time, setTime] = useState<string>(() => {
    const now = new Date();
    return now.toTimeString().slice(0, 8); // HH:MM:SS
  });

  useEffect(() => {
    const tick = (): void => {
      const now = new Date();
      setTime(now.toTimeString().slice(0, 8));
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column" width={TERM_W}>
      {/* Top info row */}
      <Box flexDirection="row" justifyContent="space-between" width={TERM_W}>
        {/* Left: brand + connection dots */}
        <Box flexDirection="row" gap={2}>
          {/* Brand label */}
          <Text bold color="yellow">dm</Text>

          {/* PM2 dot + label */}
          <Box flexDirection="row" gap={0}>
            <Text color={pm2Reachable ? 'green' : 'red'}>●</Text>
            <Text> pm2</Text>
          </Box>

          {/* DB dot + label */}
          <Box flexDirection="row" gap={0}>
            <Text color={dbReachable ? 'green' : 'red'}>●</Text>
            <Text> db</Text>
          </Box>

          {/* Optional SSH dot + label */}
          {sshHost != null && (
            <Box flexDirection="row" gap={0}>
              <Text color={sshReachable ? 'green' : 'yellow'}>●</Text>
              <Text> ssh:{sshHost}</Text>
            </Box>
          )}
        </Box>

        {/* Right: wall-clock time */}
        <Text>{time}</Text>
      </Box>

      {/* Separator line */}
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>
    </Box>
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  active: boolean;
  query: string;
}

/**
 * Text-input row below the TopBar for filtering the App_List by name.
 * - Inactive: shows dim "filter apps…" placeholder + shortcut hints on right.
 * - Active: shows query text + amber block cursor `█` + shortcut hints on right.
 *
 * State is owned by Dashboard; this component emits no callbacks.
 * Requirements: 3.1–3.7
 */
export function FilterBar({ active, query }: FilterBarProps): React.ReactElement {
  const hints = (
    <Text dimColor>
      {'/ search  : command  s sort'}
    </Text>
  );

  return (
    <Box flexDirection="row" justifyContent="space-between" width={TERM_W}>
      {/* Left: input area */}
      {active ? (
        <Text>
          {query}
          <Text bold color="yellow">█</Text>
        </Text>
      ) : (
        <Text dimColor>filter apps…</Text>
      )}

      {/* Right: shortcut hints */}
      {hints}
    </Box>
  );
}

// ─── AppRow ───────────────────────────────────────────────────────────────────

interface AppRowProps {
  data: AppData;
  selected: boolean;
}

/**
 * Two-line row for a single app in the App_List panel.
 *
 * Line 1: [▌▌] status-dot  app-name  [⚠]
 * Line 2:      dim CPU%/mem  — OR —  red "restart loop" label
 *
 * When selected: two '▌' chars in bold yellow as left border, app name in bold yellow.
 * When unselected: no border, app name in default text.
 *
 * Requirements: 4.1–4.6, 1.1
 */
export function AppRow({ data, selected }: AppRowProps): React.ReactElement {
  const { app, pm2, restartDelta } = data;
  const status = pm2?.status ?? 'not-found';
  const color = statusColor(status);

  // Available width for name: LIST_W minus border (2) minus dot (1) minus spaces (2)
  const nameMaxLen = LIST_W - (selected ? 2 : 0) - 1 - 2 - (restartDelta >= 3 ? 2 : 0);
  const displayName = truncate(app.name, Math.max(nameMaxLen, 4));

  return (
    <Box flexDirection="column" width={LIST_W}>
      {/* Line 1: border | dot  name  [⚠] */}
      <Box flexDirection="row" width={LIST_W}>
        {/* Amber left border — only on selected row */}
        {selected && (
          <Text bold color="yellow">▌▌</Text>
        )}

        {/* Status dot */}
        <Text color={color}>{statusDot(status)}</Text>

        {/* App name */}
        <Box marginLeft={1}>
        {selected ? (
          <Text bold color="yellow">{displayName}</Text>
        ) : (
          <Text>{displayName}</Text>
        )}

        </Box>

        {/* Warning glyph when in restart loop */}
        {restartDelta >= 3 && (
          <Text color="yellow"> ⚠</Text>
        )}
      </Box>

      {/* Line 2: CPU/mem OR restart loop label */}
      <Box flexDirection="row" width={LIST_W} marginLeft={selected ? 3 : 1}>
        {restartDelta >= 3 ? (
          <Text color="red">restart loop</Text>
        ) : (
          <Text dimColor>
            {pm2 ? `${pm2.cpu.toFixed(1)}%  ${fmtMem(pm2.memBytes)}` : '—'}
          </Text>
        )}
      </Box>
    </Box>
  );
}

// ─── AppList ──────────────────────────────────────────────────────────────────

interface AppListProps {
  apps: AppData[];
  cursor: number;
}

/**
 * Scrollable list of AppRow items with viewport pagination and a footer.
 *
 * - Viewport height: TERM_H - 8 rows for surrounding chrome; each app row is 2 lines.
 * - viewOffset is clamped so the cursor row is always visible.
 * - Footer: green online count, red errored count, dim stopped count — from the filtered set.
 *
 * Requirements: 4.1–4.8, 17.3
 */
export function AppList({ apps, cursor }: AppListProps): React.ReactElement {
  // Available lines for app rows (subtract chrome: topbar ~2, filterbar ~1, footer ~1, padding ~4)
  const availableLines = Math.max(TERM_H - 8, 4);
  // Each AppRow takes 2 lines
  const visibleCount = Math.floor(availableLines / 2);

  // Calculate viewOffset so the cursor is always in view
  let viewOffset = 0;
  if (cursor >= visibleCount) {
    viewOffset = cursor - visibleCount + 1;
  }
  // Ensure we don't scroll past the end
  const maxOffset = Math.max(0, apps.length - visibleCount);
  viewOffset = Math.min(viewOffset, maxOffset);

  const visibleApps = apps.slice(viewOffset, viewOffset + visibleCount);

  // Footer counts
  let onlineCount = 0;
  let erroredCount = 0;
  let stoppedCount = 0;
  for (const appData of apps) {
    const s = appData.pm2?.status ?? 'not-found';
    if (s === 'online') {
      onlineCount++;
    } else if (s === 'errored' || s === 'error') {
      erroredCount++;
    } else {
      stoppedCount++;
    }
  }

  return (
    <Box flexDirection="column" width={LIST_W}>
      {/* App rows */}
      {visibleApps.map((appData, idx) => {
        const absoluteIdx = viewOffset + idx;
        return (
          <AppRow
            key={appData.app.name}
            data={appData}
            selected={absoluteIdx === cursor}
          />
        );
      })}

      {/* Spacer when list is shorter than viewport */}
      {visibleApps.length < visibleCount && (
        <Box flexDirection="column">
          {Array.from({ length: visibleCount - visibleApps.length }).map((_, i) => (
            <Box key={i} height={2} />
          ))}
        </Box>
      )}

      {/* Footer row */}
      <Box flexDirection="row" gap={1} width={LIST_W}>
        <Text color="green">{onlineCount} online</Text>
        <Text color="red">{erroredCount} err</Text>
        <Text dimColor>{stoppedCount} stopped</Text>
      </Box>
    </Box>
  );
}

// ─── DetailHeader ─────────────────────────────────────────────────────────────

interface DetailHeaderProps {
  app: AppData | null;
}

/**
 * Single-line header at the top of the detail pane.
 *
 * When an app is selected:
 *   Left:  bold white app name  + coloured status badge pill
 *   Right: health badge [HEALTHY] / [DEGRADED] / [DOWN] / [UNKNOWN] coloured by healthColor
 *
 * When no app is selected: dim placeholder text.
 *
 * Requirements: 5.1–5.4
 */
export function DetailHeader({ app }: DetailHeaderProps): React.ReactElement {
  if (!app) {
    return (
      <Box width={DETAIL_W}>
        <Text dimColor>Select an app…</Text>
      </Box>
    );
  }

  const status = app.pm2?.status ?? 'not-found';
  const badgeColor = statusColor(status);

  // Health badge text
  let healthBadge: string;
  switch (app.health) {
    case 'healthy':  healthBadge = '[HEALTHY]';  break;
    case 'degraded': healthBadge = '[DEGRADED]'; break;
    case 'down':     healthBadge = '[DOWN]';     break;
    default:         healthBadge = '[UNKNOWN]';  break;
  }
  const hColor = healthColor(app.health);

  return (
    <Box flexDirection="row" justifyContent="space-between" width={DETAIL_W}>
      {/* Left: app name + status badge */}
      <Box flexDirection="row" gap={1}>
        <Text bold color="white">{truncate(app.app.name, Math.floor(DETAIL_W * 0.5))}</Text>
        <Text color={badgeColor}>{status}</Text>
      </Box>

      {/* Right: health badge */}
      <Text color={hColor}>{healthBadge}</Text>
    </Box>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

interface TabBarProps {
  active: DetailTab;
}

const TAB_KEYS: DetailTab[] = ['overview', 'metrics', 'logs', 'deploys', 'domains'];
const TAB_LABELS: string[]   = ['Overview', 'Metrics', 'Logs', 'Deploys', 'Domains'];

/**
 * Horizontal tab strip below DetailHeader.
 *
 * - Active tab label: amber (bold yellow)
 * - Inactive tab labels: dim
 * - Remaining width filled with dim ─ characters (total width = DETAIL_W)
 *
 * Requirements: 6.1–6.6
 */
export function TabBar({ active }: TabBarProps): React.ReactElement {
  // Build the raw text so we can measure how many fill chars we need.
  // Each tab is rendered as " Label " (space-padded). We compute the total
  // character width of all labels to leave the right amount of ─ fill.
  const tabTexts = TAB_LABELS.map((label) => ` ${label} `);
  const tabsCharWidth = tabTexts.reduce((sum, t) => sum + t.length, 0);
  const fillCount = Math.max(0, DETAIL_W - tabsCharWidth);

  return (
    <Box flexDirection="row" width={DETAIL_W}>
      {/* Tab labels */}
      {TAB_KEYS.map((tabKey, i) => {
        const isActive = tabKey === active;
        return isActive ? (
          <Text key={tabKey} bold color="yellow">{tabTexts[i]}</Text>
        ) : (
          <Text key={tabKey} dimColor>{tabTexts[i]}</Text>
        );
      })}

      {/* Dim fill ─ chars */}
      {fillCount > 0 && (
        <Text dimColor>{'─'.repeat(fillCount)}</Text>
      )}
    </Box>
  );
}

// ─── OverviewTab ─────────────────────────────────────────────────────────────

interface OverviewTabProps {
  data: AppData;
}

/**
 * Overview tab — dense information grid for a single app.
 *
 * Renders:
 *   1. Two-column KV grid (Port, Type, Instances, Branch | Commit, Deployed, Restarts, Active Build)
 *   2. Quick-badges row (VCS status, cert-days, env-changed)
 *   3. Last commit section (message, author, relative timestamp)
 *   4. Routes section (path → appName, https indicator)
 *
 * Requirements: 7.1–7.8
 */
export function OverviewTab({ data }: OverviewTabProps): React.ReactElement {
  const { app, pm2, drift, domains, envChanged } = data;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Derive a vcs-status string from VcsDriftInfo fields */
  function vcsStatus(): 'up-to-date' | 'behind' | 'ahead' | 'diverged' | 'unknown' {
    if (!drift) return 'unknown';
    if (drift.behind > 0 && drift.ahead > 0) return 'diverged';
    if (drift.behind > 0) return 'behind';
    if (drift.ahead > 0) return 'ahead';
    return 'up-to-date';
  }

  /** Colour for a vcs-status string */
  function vcsColor(s: ReturnType<typeof vcsStatus>): string {
    switch (s) {
      case 'up-to-date': return 'green';
      case 'behind':     return 'yellow';
      case 'ahead':      return 'yellow';
      case 'diverged':   return 'red';
      default:           return 'gray';
    }
  }

  /** Human-readable label for vcs-status */
  function vcsLabel(s: ReturnType<typeof vcsStatus>): string {
    switch (s) {
      case 'up-to-date': return 'up to date';
      case 'behind':     return 'behind';
      case 'ahead':      return 'ahead';
      case 'diverged':   return 'diverged';
      default:           return 'unknown';
    }
  }

  /** Cert badge for first domain with a cert, or null */
  function firstCert(): { daysRemaining: number | undefined; certValid: boolean } | null {
    for (const d of domains) {
      if (d.cert.mode !== 'none') {
        return {
          daysRemaining: d.cert.daysRemaining,
          certValid: !d.cert.isExpired,
        };
      }
    }
    return null;
  }

  /** Colour for cert badge based on days remaining */
  function certBadgeColor(daysRemaining: number | undefined): string {
    if (daysRemaining === undefined) return 'gray';
    if (daysRemaining < 7) return 'red';
    if (daysRemaining < 30) return 'yellow';
    return 'green';
  }

  /** Returns basename of a path string */
  function basename(p: string): string {
    return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const status = vcsStatus();
  const cert = firstCert();

  // Commit info from lastDeployedCommit
  const commit = app.lastDeployedCommit;
  const shortHash = commit?.hash ? commit.hash.slice(0, 7) : '—';
  const commitMsg = commit?.message ?? '—';
  const commitAuthor = commit?.author ?? '—';
  const commitDate = commit?.date ? fmtDate(new Date(commit.date)) : '—';

  // Deployed timestamp
  const deployedAt = app.lastDeploy;

  // Active build display
  let activeBuildDisplay = '—';
  if (app.activeBuild) {
    const name = basename(app.activeBuild);
    const total = app.builds?.length ?? 0;
    activeBuildDisplay = total > 0 ? `${name} (${total} total)` : name;
  }

  // Restarts
  const restarts = pm2?.restarts ?? 0;

  // App type display
  const typeDisplay = app.projectType ?? '—';

  // Instances
  const instancesDisplay = String(app.instances ?? 1);

  // ── KV row helper ─────────────────────────────────────────────────────────

  const KVItem = ({
    label,
    value,
    valueColor,
  }: {
    label: string;
    value: string;
    valueColor?: string;
  }): React.ReactElement => (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>{pad(label + ':', 12)}</Text>
      {valueColor ? (
        <Text color={valueColor}>{truncate(value, DETAIL_W / 2 - 14)}</Text>
      ) : (
        <Text>{truncate(value, DETAIL_W / 2 - 14)}</Text>
      )}
    </Box>
  );

  // ── All domain routes (flattened) ─────────────────────────────────────────

  type RouteEntry = { path: string; appName: string; certValid: boolean };
  const allRoutes: RouteEntry[] = [];
  for (const d of domains) {
    const certValid = !d.cert.isExpired && d.cert.mode !== 'none';
    for (const r of d.routes) {
      allRoutes.push({ path: r.path, appName: r.appName, certValid });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" width={DETAIL_W} gap={1}>

      {/* 1. Two-column KV grid */}
      <Box flexDirection="row" gap={2}>
        {/* Left column: Port, Type, Instances, Branch */}
        <Box flexDirection="column" width={Math.floor(DETAIL_W / 2)}>
          <KVItem label="Port"      value={String(app.port)} />
          <KVItem label="Type"      value={typeDisplay} />
          <KVItem label="Instances" value={instancesDisplay} />
          <KVItem label="Branch"    value={drift?.branch ?? app.branch ?? '—'} />
        </Box>

        {/* Right column: Commit (amber), Deployed, Restarts, Active Build */}
        <Box flexDirection="column" width={Math.floor(DETAIL_W / 2)}>
          <KVItem label="Commit"       value={shortHash} valueColor="yellow" />
          <KVItem label="Deployed"     value={fmtDate(deployedAt)} />
          <KVItem label="Restarts"     value={String(restarts)} />
          <KVItem label="Active Build" value={activeBuildDisplay} />
        </Box>
      </Box>

      {/* 2. Quick-badges row */}
      <Box flexDirection="row" gap={2}>
        {/* VCS status badge */}
        <Text color={vcsColor(status)}>[{vcsLabel(status)}]</Text>

        {/* Cert-days badge */}
        {cert !== null ? (
          <Text color={certBadgeColor(cert.daysRemaining)}>
            {cert.daysRemaining !== undefined
              ? `[cert ${cert.daysRemaining}d]`
              : '[cert —]'}
          </Text>
        ) : (
          <Text dimColor>[no cert]</Text>
        )}

        {/* Env-changed badge */}
        {envChanged === true && (
          <Text color="yellow">[env changed]</Text>
        )}
      </Box>

      {/* 3. Last commit section */}
      <Box flexDirection="column">
        <Text dimColor>Last commit</Text>
        <Box flexDirection="row" gap={1} marginLeft={2}>
          <Text dimColor>{truncate(commitMsg, DETAIL_W - 4)}</Text>
        </Box>
        <Box flexDirection="row" gap={2} marginLeft={2}>
          <Text>{commitAuthor}</Text>
          <Text dimColor>{commitDate}</Text>
        </Box>
      </Box>

      {/* 4. Routes section */}
      <Box flexDirection="column">
        <Text dimColor>Routes</Text>
        {allRoutes.length === 0 ? (
          <Box marginLeft={2}><Text dimColor>No routes configured</Text></Box>
        ) : (
          allRoutes.map((r, i) => (
            <Box key={i} flexDirection="row" gap={1} marginLeft={2}>
              <Text>{r.path || '/'}</Text>
              <Text dimColor>→</Text>
              <Text>{r.appName}</Text>
              {r.certValid && <Text color="green">  [https]</Text>}
            </Box>
          ))
        )}
      </Box>

    </Box>
  );
}

// ─── MetricsTab ──────────────────────────────────────────────────────────────

interface MetricsTabProps {
  data: AppData;
  cpuHistory: number[];
  memHistory: number[];
  totalMemBytes?: number;
}

/**
 * Metrics tab — CPU/memory sparklines and per-domain nginx request metrics.
 *
 * - CPU sparkline row: label "CPU", green sparkline (20 chars), current CPU%
 * - Memory sparkline row: label "Memory", blue sparkline, current mem value, inline gauge bar
 * - Restart-delta warning when restartDelta > 0
 * - Per-domain "Request metrics" section with req/s sparkline, status counters, p50/p95
 * - Honest "not available" messages — never zeros for unavailable data
 *
 * Requirements: 8.1–8.6, 16.1–16.3
 */
export function MetricsTab({
  data,
  cpuHistory,
  memHistory,
  totalMemBytes,
}: MetricsTabProps): React.ReactElement {
  const { pm2, pm2Error, domains, restartDelta } = data;

  // ── Gauge bar helper ────────────────────────────────────────────────────────
  // 10-char bar of █ (filled) and ░ (empty) based on fraction

  function gaugeBar(fraction: number, width = 10): string {
    const clamped = Math.max(0, Math.min(1, fraction));
    const filled = Math.round(clamped * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  // ── CPU row ─────────────────────────────────────────────────────────────────

  const cpuSparkStr = sparkline(cpuHistory, 20);
  let cpuValueStr: string;
  if (pm2Error) {
    cpuValueStr = pm2Error; // "PM2 unreachable"
  } else if (!pm2) {
    cpuValueStr = 'PM2 unreachable';
  } else {
    cpuValueStr = `${pm2.cpu.toFixed(1)}%`;
  }

  // ── Memory row ──────────────────────────────────────────────────────────────

  const memSparkStr = sparkline(memHistory, 20);
  let memValueStr: string;
  let memGaugeFraction = 0;
  let showGauge = false;

  if (pm2Error || !pm2) {
    memValueStr = pm2Error ?? 'PM2 unreachable';
    showGauge = false;
  } else {
    memValueStr = fmtMem(pm2.memBytes);
    if (totalMemBytes && totalMemBytes > 0) {
      memGaugeFraction = pm2.memBytes / totalMemBytes;
      showGauge = true;
    }
  }

  // ── Domain request metrics section ──────────────────────────────────────────

  const hasDomains = domains.length > 0;

  return (
    <Box flexDirection="column" width={DETAIL_W} gap={1}>

      {/* ── CPU sparkline row ── */}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{pad('CPU:', 8)}</Text>
        <Text color="green">{cpuSparkStr}</Text>
        <Text> </Text>
        {pm2Error || !pm2 ? (
          <Text dimColor>{cpuValueStr}</Text>
        ) : (
          <Text>{cpuValueStr}</Text>
        )}
      </Box>

      {/* ── Memory sparkline row ── */}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{pad('Memory:', 8)}</Text>
        <Text color="blue">{memSparkStr}</Text>
        <Text> </Text>
        {pm2Error || !pm2 ? (
          <Text dimColor>{memValueStr}</Text>
        ) : (
          <>
            <Text>{memValueStr}</Text>
            {showGauge && (
              <>
                <Text> </Text>
                <Text dimColor>[</Text>
                <Text color={memGaugeFraction > 0.85 ? 'red' : memGaugeFraction > 0.6 ? 'yellow' : 'green'}>
                  {gaugeBar(memGaugeFraction)}
                </Text>
                <Text dimColor>]</Text>
              </>
            )}
          </>
        )}
      </Box>

      {/* ── Restart-delta warning ── */}
      {restartDelta >= 3 && (
        <Box flexDirection="row" gap={1}>
          <Text color="yellow">⚠</Text>
          <Text color="yellow">
            {restartDelta === 1
              ? `1 restart since dashboard opened`
              : `${restartDelta} restarts since dashboard opened`}
          </Text>
        </Box>
      )}

      {/* ── Request metrics section ── */}
      <Box flexDirection="column">
        <Text dimColor>Request metrics</Text>

        {!hasDomains ? (
          <Box marginLeft={2}>
            <Text dimColor>No domain routed to this app — request metrics require a proxied domain</Text>
          </Box>
        ) : (
          domains.map((domain) =>
            domain.routes.map((route) => (
              <Box key={`${domain.name}:${route.path}`} flexDirection="column" marginTop={1} marginLeft={2}>
                {/* Route header: domain + path */}
                <Text bold>{truncate(domain.name, DETAIL_W - 10)}<Text dimColor>{route.path}</Text></Text>

                {/* Case 1: Domain has never been pushed to Nginx */}
                {!domain.lastPushedAt && (
                  <Box marginLeft={2}>
                    <Text dimColor>not pushed to Nginx — no request metrics available</Text>
                  </Box>
                )}

                {/* Case 2: Pushed but log has no data */}
                {domain.lastPushedAt && (!route.nginxLog || !route.nginxLog.hasData) && (
                  <Box marginLeft={2}>
                    {route.nginxLog?.error ? (
                      <Text dimColor>log unavailable — {truncate(route.nginxLog.error, DETAIL_W - 20)}</Text>
                    ) : (
                      <Text dimColor>no requests recorded yet — metrics will appear once traffic flows</Text>
                    )}
                  </Box>
                )}

                {/* Case 3: Data available */}
                {domain.lastPushedAt && route.nginxLog && route.nginxLog.hasData && (
                  <Box flexDirection="column" marginLeft={2}>
                    <Box flexDirection="row" gap={1}>
                      <Text dimColor>{pad('req/s:', 8)}</Text>
                      <Text color="yellow">{route.nginxLog.reqPerSec.toFixed(1)}</Text>
                    </Box>
                    <Box flexDirection="row" gap={2}>
                      <Text dimColor>status:</Text>
                      <Text color="green">2XX {route.nginxLog.statusDist.s2xx}</Text>
                      <Text color="yellow">4XX {route.nginxLog.statusDist.s4xx}</Text>
                      <Text color="red">5XX {route.nginxLog.statusDist.s5xx}</Text>
                    </Box>
                    {route.nginxLog.p50ms !== undefined && (
                      <Box flexDirection="row" gap={2}>
                        <Text dimColor>latency:</Text>
                        <Text>p50 {route.nginxLog.p50ms}ms</Text>
                        {route.nginxLog.p95ms !== undefined && (
                          <Text>p95 {route.nginxLog.p95ms}ms</Text>
                        )}
                      </Box>
                    )}
                    {route.nginxLog.noResponseTime && (
                      <Text dimColor>response times unavailable — regenerate nginx config for dm_json format</Text>
                    )}
                  </Box>
                )}
              </Box>
            ))
          )
        )}
      </Box>

    </Box>
  );
}

// ─── LogsTab ─────────────────────────────────────────────────────────────────

interface LogsTabProps {
  logLines: string[];
}

/** Severity levels for individual log lines. */
type LogSeverity = 'error' | 'warn' | 'info';

/** Parsed representation of a single log line. */
interface ParsedLogLine {
  timestamp: string;
  message: string;
  severity: LogSeverity;
}

const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\s*(.*)/s;

/**
 * Classifies a raw log line string into error / warn / info severity.
 *
 * Priority order:
 *   1. error  — contains [err], Error, or ERROR
 *   2. warn   — contains warn or WARN (only when not already error)
 *   3. info   — everything else
 */
function classifySeverity(line: string): LogSeverity {
  if (line.includes('[err]') || line.includes('Error') || line.includes('ERROR')) {
    return 'error';
  }
  if (line.includes('warn') || line.includes('WARN')) {
    return 'warn';
  }
  return 'info';
}

/**
 * Parses a raw log line into { timestamp, message, severity }.
 *
 * Timestamp extraction: tries /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\s*(.*)/
 * If no match, timestamp is empty and the full line is the message.
 */
function parseLogLine(raw: string): ParsedLogLine {
  const match = LOG_TS_RE.exec(raw);
  const timestamp = match ? match[1] : '';
  const message   = match ? match[2] : raw;
  const severity  = classifySeverity(raw);
  return { timestamp, message, severity };
}

/**
 * Logs tab — streams PM2 bus log lines with severity colouring and pagination.
 *
 * - Classifies each line: error / warn / info (see classifySeverity)
 * - Renders: timestamp + severity glyph + message
 *   · info    dim full line
 *   ! warn    yellow glyph, default message text
 *   ✕ error   full line red
 * - Max visible: TERM_H - 12 lines; shows the LAST N lines of logLines
 * - Empty state: dim instructional message
 *
 * Requirements: 9.1–9.8
 */
export function LogsTab({ logLines }: LogsTabProps): React.ReactElement {
  const maxVisible = Math.max(1, TERM_H - 12);

  if (logLines.length === 0) {
    return (
      <Box width={DETAIL_W}>
        <Text dimColor>No log output captured yet. Logs stream in as the app produces them.</Text>
      </Box>
    );
  }

  // Show the most recent N lines
  const visibleLines = logLines.slice(-maxVisible);
  const parsed = visibleLines.map(parseLogLine);

  return (
    <Box flexDirection="column" width={DETAIL_W}>
      {parsed.map((entry, i) => {
        const tsText = entry.timestamp ? `${entry.timestamp} ` : '';

        if (entry.severity === 'error') {
          return (
            <Text key={i} color="red">
              {tsText}{'✕ '}{entry.message}
            </Text>
          );
        }

        if (entry.severity === 'warn') {
          return (
            <Box key={i} flexDirection="row">
              {tsText !== '' && <Text>{tsText}</Text>}
              <Text color="yellow">{'! '}</Text>
              <Text>{entry.message}</Text>
            </Box>
          );
        }

        // info — dim full line
        return (
          <Text key={i} dimColor>
            {tsText}{'· '}{entry.message}
          </Text>
        );
      })}
    </Box>
  );
}

// ─── DeploysTab ──────────────────────────────────────────────────────────────

interface DeploysTabProps {
  data: AppData;
  deployCursor: number;
  onAction: (action: DashboardAction) => void;
}

/**
 * Deploys tab — scrollable list of build history entries.
 *
 * Each row shows:
 *   ● (bold yellow) for the active build, ○ (dim) for others
 *   Short 7-char commit hash in amber (from lastDeployedCommit for the active build,
 *   or derived from the build directory basename for others)
 *   Truncated build label / commit message
 *   Relative age via fmtDate (derived from App.lastDeploy for active build)
 *
 * Row highlighting:
 *   - Active build row: dim amber background indication (dim "[active]" suffix)
 *   - Cursor row: amber left-border ▌▌ (bold yellow) + bold amber text
 *
 * Empty state: dim "No builds found." when app.builds is empty or undefined.
 *
 * Note: Enter key handling is wired in Task 14 (Dashboard input handler).
 * This component renders only; onAction is passed through for documentation.
 *
 * Requirements: 10.1–10.6
 */
export function DeploysTab({ data, deployCursor }: DeploysTabProps): React.ReactElement {
  const { app } = data;
  const builds = app.builds ?? [];

  // Empty state
  if (builds.length === 0) {
    return (
      <Box width={DETAIL_W}>
        <Text dimColor>No builds found.</Text>
      </Box>
    );
  }

  // Determine which build index is active by matching path to app.activeBuild
  const activeBuildIndex = app.activeBuild
    ? builds.findIndex((b) => b === app.activeBuild)
    : -1;

  // Derive display info per build
  // The model only carries lastDeployedCommit for the currently active build.
  // For other builds we fall back to the directory basename as the identifier.
  const activeCommit = app.lastDeployedCommit;
  const activeDeployDate = app.lastDeploy;

  return (
    <Box flexDirection="column" width={DETAIL_W}>
      {builds.map((buildPath, idx) => {
        const isActive = idx === activeBuildIndex;
        const isCursor = idx === deployCursor;

        // ── Build display values ──────────────────────────────────────────────
        // For the active build, use lastDeployedCommit data when available.
        // For other builds, derive a short label from the directory basename.
        let shortHash: string;
        let commitMsg: string;
        let ageStr: string;

        if (isActive && activeCommit) {
          shortHash = activeCommit.hash.slice(0, 7);
          commitMsg = activeCommit.message;
          ageStr = fmtDate(activeDeployDate);
        } else {
          // Derive from basename — strip trailing slashes first
          const basename = buildPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? buildPath;
          shortHash = basename.slice(0, 7);
          commitMsg = basename;
          ageStr = '—';
        }

        // Available width for commit message after fixed elements:
        // border(2) + space(1) + dot(1) + space(1) + hash(7) + space(1) + age(~8) + active(~9) = ~30
        const msgMaxLen = Math.max(10, DETAIL_W - (isCursor ? 2 : 0) - 1 - 1 - 1 - 7 - 1 - 9 - (isActive ? 10 : 0));

        return (
          <Box key={idx} flexDirection="row" width={DETAIL_W}>
            {/* Cursor indicator — amber left border */}
            {isCursor ? (
              <Text bold color="yellow">▌▌</Text>
            ) : (
              <Text>{'  '}</Text>
            )}

            {/* Active/inactive dot */}
            {isActive ? (
              <Text bold color="yellow">● </Text>
            ) : (
              <Text dimColor>○ </Text>
            )}

            {/* Short commit hash in amber */}
            <Text bold color="yellow">{shortHash}</Text>
            <Text> </Text>

            {/* Truncated commit message */}
            {isCursor ? (
              <Text bold color="yellow">{truncate(commitMsg, msgMaxLen)}</Text>
            ) : isActive ? (
              <Text>{truncate(commitMsg, msgMaxLen)}</Text>
            ) : (
              <Text dimColor>{truncate(commitMsg, msgMaxLen)}</Text>
            )}

            {/* [active] suffix for active build */}
            {isActive && (
              <Text dimColor> [active]</Text>
            )}

            {/* Relative age — right-aligned feel via a space separator */}
            <Text dimColor>  {ageStr}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── DomainsTab ──────────────────────────────────────────────────────────────

interface DomainsTabProps {
  data: AppData;
}

/**
 * Domains tab — one card per domain with cert badge, issuer, last-pushed time,
 * stale-config indicator, and route list.
 *
 * Cert badge thresholds (daysRemaining):
 *   < 7 days  → red
 *   < 30 days → yellow
 *   valid     → green
 *   no cert / expired / error → red
 *
 * Stale indicator: yellow "[config stale]" when domain.isStale is true.
 *
 * Routes: "  {path} → {appName}" per route entry.
 *
 * Empty state: dim placeholder when domains array is empty.
 *
 * Requirements: 11.1–11.5
 */
export function DomainsTab({ data }: DomainsTabProps): React.ReactElement {
  const { domains } = data;

  // ── Cert badge helpers ────────────────────────────────────────────────────

  /** Returns the colour for a cert badge. */
  function certColor(cert: DomainInfo['cert']): string {
    if (cert.mode === 'none') return 'red';
    if (cert.isExpired) return 'red';
    if (cert.error) return 'red';
    if (cert.daysRemaining !== undefined) {
      if (cert.daysRemaining < 7) return 'red';
      if (cert.daysRemaining < 30) return 'yellow';
      return 'green';
    }
    // letsencrypt mode without parsed daysRemaining — treat as valid (green)
    if (cert.mode === 'letsencrypt' || cert.mode === 'custom') return 'green';
    return 'red';
  }

  /** Returns the cert badge label string. */
  function certLabel(cert: DomainInfo['cert']): string {
    if (cert.mode === 'none') return '[no cert]';
    if (cert.error) return `[cert error]`;
    if (cert.isExpired) return '[expired]';
    if (cert.daysRemaining !== undefined) return `[cert ${cert.daysRemaining}d]`;
    if (cert.mode === 'letsencrypt') return '[let\'s encrypt]';
    return '[cert]';
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (domains.length === 0) {
    return (
      <Box width={DETAIL_W}>
        <Text dimColor>No domains configured for this app.</Text>
      </Box>
    );
  }

  // ── Domain cards ──────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" width={DETAIL_W}>
      {domains.map((domain, idx) => {
        const badgeColor = certColor(domain.cert);
        const badge = certLabel(domain.cert);

        return (
          <Box
            key={domain.name}
            flexDirection="column"
            width={DETAIL_W}
            marginTop={idx === 0 ? 0 : 1}
          >
            {/* Card header: bold domain name + cert badge */}
            <Box flexDirection="row" gap={1} width={DETAIL_W}>
              <Text bold>{truncate(domain.name, DETAIL_W - 20)}</Text>
              <Text color={badgeColor}>{badge}</Text>
              {domain.isStale && (
                <Text color="yellow">[config stale]</Text>
              )}
            </Box>

            {/* Issuer line — only for custom certs that have an issuer */}
            {domain.cert.issuer && (
              <Box marginLeft={2}>
                <Text dimColor>issuer: {truncate(domain.cert.issuer, DETAIL_W - 12)}</Text>
              </Box>
            )}

            {/* Last-pushed timestamp */}
            <Box marginLeft={2}>
              <Text dimColor>pushed: {fmtDate(domain.lastPushedAt)}</Text>
            </Box>

            {/* Routes list */}
            <Box flexDirection="column" marginLeft={2} marginTop={0}>
              {domain.routes.length === 0 ? (
                <Text dimColor>no routes</Text>
              ) : (
                domain.routes.map((r, ri) => (
                  <Box key={ri} flexDirection="row">
                    <Text dimColor>  {r.path}</Text>
                    <Text dimColor> → </Text>
                    <Text>{r.appName}</Text>
                  </Box>
                ))
              )}
            </Box>

            {/* Separator line between cards (not after the last card) */}
            {idx < domains.length - 1 && (
              <Text dimColor>{'─'.repeat(Math.min(DETAIL_W, 40))}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Keybar ──────────────────────────────────────────────────────────────────

interface KeybarProps {
  activeTab: DetailTab;
}

/**
 * Context-sensitive key-hint strip rendered at the very bottom of the Dashboard.
 *
 * Always-visible hints: Tab (switch tab), Esc (back/dismiss), q (quit).
 * Per-tab additional hints:
 *   overview  — r restart, S stop, D redeploy, E env
 *   metrics   — f fullscreen, c copy value
 *   logs      — f fullscreen, / grep logs, c copy line
 *   deploys   — ↵ rollback to selected, c copy commit
 *   domains   — ↵ view nginx config, c copy url
 *
 * Rendering: bold white key label + dim description, all in a single horizontal row.
 * Preceded by a full-width dim ─ separator line.
 *
 * Requirements: 15.1–15.8
 */
export function Keybar({ activeTab }: KeybarProps): React.ReactElement {
  /** Renders a single key hint: bold white label + dim description. */
  const Hint = ({
    label,
    desc,
  }: {
    label: string;
    desc: string;
  }): React.ReactElement => (
    <>
      <Text bold color="white">{label}</Text>
      <Text dimColor>{` ${desc}  `}</Text>
    </>
  );

  // ── Tab-specific hints ─────────────────────────────────────────────────────

  const tabHints: React.ReactElement = (() => {
    switch (activeTab) {
      case 'overview':
        return (
          <>
            <Hint label="r" desc="restart" />
            <Hint label="S" desc="stop" />
            <Hint label="D" desc="redeploy" />
            <Hint label="E" desc="env" />
          </>
        );
      case 'metrics':
        return (
          <>
            <Hint label="f" desc="fullscreen" />
            <Hint label="c" desc="copy value" />
          </>
        );
      case 'logs':
        return (
          <>
            <Hint label="f" desc="fullscreen" />
            <Hint label="/" desc="grep logs" />
            <Hint label="c" desc="copy line" />
          </>
        );
      case 'deploys':
        return (
          <>
            <Hint label="↵" desc="rollback to selected" />
            <Hint label="c" desc="copy commit" />
          </>
        );
      case 'domains':
        return (
          <>
            <Hint label="↵" desc="view nginx config" />
            <Hint label="c" desc="copy url" />
          </>
        );
    }
  })();

  return (
    <Box flexDirection="column" width={TERM_W}>
      {/* Separator */}
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>

      {/* Key hints row */}
      <Box flexDirection="row">
        {/* Always-visible hints */}
        <Hint label="Tab" desc="switch tab" />
        <Hint label="Esc" desc="back/dismiss" />
        <Hint label="q" desc="quit" />

        {/* Tab-specific hints */}
        {tabHints}
      </Box>
    </Box>
  );
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

const PALETTE_VERBS = ['restart', 'stop', 'deploy', 'logs', 'env', 'rollback'] as const;
type PaletteVerb = (typeof PALETTE_VERBS)[number];

interface CommandPaletteProps {
  input: string;
  appNames: string[];
}

/**
 * Parses a palette input string ("verb appName") into a DashboardAction.
 * Returns null if the verb is not valid or appName does not match a known app.
 *
 * Exported so Task 14 can use it from the main Dashboard input handler.
 *
 * Requirements: 12.1–12.7
 */
export function parsePaletteInput(input: string, appNames: string[]): DashboardAction | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return null;

  const verb = trimmed.slice(0, spaceIdx).toLowerCase();
  const appName = trimmed.slice(spaceIdx + 1).trim();

  if (!appName) return null;
  if (!(PALETTE_VERBS as readonly string[]).includes(verb)) return null;

  // appName must match a known app (case-insensitive)
  const matchedApp = appNames.find((n) => n.toLowerCase() === appName.toLowerCase());
  if (!matchedApp) return null;

  return { type: verb as PaletteVerb, appName: matchedApp };
}

/**
 * Returns up to 5 "{verb} {appName}" suggestions whose full string starts with
 * (or contains) `input` (case-insensitive).
 *
 * Exported for use in tests and Task 14's input handler.
 */
export function getPaletteSuggestions(input: string, appNames: string[]): string[] {
  const query = input.toLowerCase().trim();
  const all: string[] = [];

  for (const verb of PALETTE_VERBS) {
    for (const appName of appNames) {
      all.push(`${verb} ${appName}`);
    }
  }

  if (!query) return all.slice(0, 5);

  // First: suggestions that START with the query
  const startsWith = all.filter((s) => s.toLowerCase().startsWith(query));
  if (startsWith.length >= 5) return startsWith.slice(0, 5);

  // Then: suggestions that CONTAIN the query but don't start with it
  const contains = all.filter(
    (s) => s.toLowerCase().includes(query) && !s.toLowerCase().startsWith(query),
  );

  return [...startsWith, ...contains].slice(0, 5);
}

/**
 * Command palette overlay — amber-bordered box with autocomplete suggestions.
 *
 * - Amber (yellow) round border, centered, fixed width min(60, TERM_W - 4).
 * - Input line: ": {input}█" where █ is bold yellow.
 * - Up to 5 suggestion rows; top suggestion highlighted with bold yellow "▶ " prefix + white text.
 * - Other suggestions: dim with "  " prefix.
 *
 * Tab completion, Enter execution, and Esc handling are wired in Task 14
 * (the main Dashboard input handler). This component is purely presentational.
 *
 * Requirements: 12.1–12.7
 */
export function CommandPalette({
  input,
  appNames,
}: CommandPaletteProps): React.ReactElement {
  const paletteWidth = Math.min(60, TERM_W - 4);
  const suggestions = getPaletteSuggestions(input, appNames);

  return (
    <Box
      flexDirection="column"
      alignSelf="center"
      width={paletteWidth}
      borderStyle="round"
      borderColor="yellow"
    >
      {/* Input line: ": {input}█" */}
      <Box flexDirection="row">
        <Text>: {input}</Text>
        <Text bold color="yellow">█</Text>
      </Box>

      {/* Suggestion rows */}
      {suggestions.map((suggestion, idx) => {
        const isTop = idx === 0;
        return (
          <Box key={suggestion} flexDirection="row">
            {isTop ? (
              <>
                <Text bold color="yellow">▶ </Text>
                <Text bold color="white">{suggestion}</Text>
              </>
            ) : (
              <>
                <Text dimColor>{'  '}</Text>
                <Text dimColor>{suggestion}</Text>
              </>
            )}
          </Box>
        );
      })}

      {/* Empty state when no suggestions match */}
      {suggestions.length === 0 && (
        <Box>
          <Text dimColor>  no matching commands</Text>
        </Box>
      )}
    </Box>
  );
}

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  description: string;
}

/**
 * Confirmation overlay for destructive actions (restart, stop).
 *
 * - Red round border, centered, width min(50, TERM_W - 4).
 * - Title in red.
 * - Description in default text.
 * - Key hints: bold white "y" + dim " confirm  " + bold white "n" + dim " cancel".
 *
 * y / Enter → invoke onConfirm; n / Esc → invoke onCancel.
 * Key handling is wired in the main Dashboard input handler (Task 14).
 * This component is purely presentational.
 *
 * Requirements: 13.1–13.5
 */
export function ConfirmDialog({
  title,
  description,
}: ConfirmDialogProps): React.ReactElement {
  const dialogWidth = Math.min(50, TERM_W - 4);

  return (
    <Box
      flexDirection="column"
      alignSelf="center"
      width={dialogWidth}
      borderStyle="round"
      borderColor="red"
    >
      {/* Title in red */}
      <Text color="red">{title}</Text>

      {/* Description in default colour */}
      <Text>{description}</Text>

      {/* Key hints row */}
      <Box flexDirection="row">
        <Text bold color="white">y</Text>
        <Text dimColor>{' confirm  '}</Text>
        <Text bold color="white">n</Text>
        <Text dimColor>{' cancel'}</Text>
      </Box>
    </Box>
  );
}

// ─── CrashLoopToast ───────────────────────────────────────────────────────────

interface CrashLoopToastProps {
  appName: string;
  restartCount: number;
  tickCount: number;
  onDismiss: () => void;
}

/**
 * Dismissible banner shown when an app enters a crash/restart loop.
 *
 * Visual: yellow ▌ glyph column on the left, then:
 *   "⚠ {appName} has restarted {n} times  L to view logs"
 *
 * - ▌ and ⚠ are coloured yellow; app name and counts are default text;
 *   "L to view logs" hint is dim.
 * - Auto-dismisses when tickCount >= TOAST_TTL_TICKS (via useEffect).
 * - Esc dismisses immediately — handled in the main input handler.
 * - Banner spans the full TERM_W.
 *
 * Requirements: 14.1–14.5
 */
export function CrashLoopToast({
  appName,
  restartCount,
  tickCount,
  onDismiss,
}: CrashLoopToastProps): React.ReactElement {
  // Auto-dismiss after TOAST_TTL_TICKS render cycles
  useEffect(() => {
    if (tickCount >= TOAST_TTL_TICKS) {
      onDismiss();
    }
  }, [tickCount, onDismiss]);

  return (
    <Box flexDirection="row" width={TERM_W}>
      {/* Yellow left-border glyph */}
      <Text color="yellow">▌</Text>
      <Text> </Text>

      {/* Warning icon in yellow */}
      <Text color="yellow">⚠</Text>
      <Text> </Text>

      {/* App name and restart count in default text */}
      <Text>{appName} has restarted {restartCount} {restartCount === 1 ? 'time' : 'times'}</Text>
      <Text>{'  '}</Text>

      {/* Key hint in dim text */}
      <Text dimColor>L to view logs</Text>
    </Box>
  );
}

// ─── Main Dashboard component — wiring (Task 14) ─────────────────────────────

export function Dashboard(props: DashboardProps): React.ReactElement {
  const { exit } = useApp();

  // ── State ──────────────────────────────────────────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [cmdInput, setCmdInput] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [deployCursor, setDeployCursor] = useState(0);
  const [toastAppName, setToastAppName] = useState<string | null>(null);
  const [toastTick, setToastTick] = useState(0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const cpuHistories = useRef<Map<string, number[]>>(new Map());
  const memHistories = useRef<Map<string, number[]>>(new Map());

  // ── Derived ────────────────────────────────────────────────────────────────
  const apps = props.state?.apps ?? [];
  const filteredApps = filterQuery.trim()
    ? apps.filter(a => a.app.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : apps;
  const selectedApp = filteredApps[cursor] ?? null;
  const appNames = apps.map(a => a.app.name);

  // ── Effect 1: Sparkline history ───────────────────────────────────────────
  useEffect(() => {
    for (const appData of apps) {
      const name = appData.app.name;
      const cpu = appData.pm2?.cpu ?? 0;
      const mem = appData.pm2?.memBytes ?? 0;
      const prevCpu = cpuHistories.current.get(name) ?? [];
      const prevMem = memHistories.current.get(name) ?? [];
      cpuHistories.current.set(name, [...prevCpu, cpu].slice(-30));
      memHistories.current.set(name, [...prevMem, mem / 1024 / 1024].slice(-30));
    }
  }, [props.state?.tickCount]);

  // ── Effect 2: Cursor bounds ────────────────────────────────────────────────
  useEffect(() => {
    if (cursor >= filteredApps.length && filteredApps.length > 0) {
      setCursor(filteredApps.length - 1);
    }
  }, [filteredApps.length]);

  // ── Effect 3: Deploy cursor reset ─────────────────────────────────────────
  useEffect(() => {
    setDeployCursor(0);
  }, [selectedApp?.app.name]);

  // ── Effect 4: Crash-loop toast + tick ──────────────────────────────────────
  useEffect(() => {
    // Scan ALL apps (not just selected) so background crash-loops are caught
    if (!toastAppName) {
      const looping = apps.find(a => a.restartDelta >= 3);
      if (looping) {
        setToastAppName(looping.app.name);
        setToastTick(0);
      }
    }
    if (toastAppName) {
      setToastTick(t => t + 1);
    }
  }, [props.state?.tickCount]);

  // ── Tabs constant ──────────────────────────────────────────────────────────
  const TABS: DetailTab[] = ['overview', 'metrics', 'logs', 'deploys', 'domains'];

  // ── Input handler ──────────────────────────────────────────────────────────
  useInput((input, key) => {
    // 1. Toast active + Escape → dismiss toast
    if (toastAppName && key.escape) {
      setToastAppName(null);
      setToastTick(0);
      return;
    }

    // 2. Command palette mode
    if (actionMode === 'cmd-palette') {
      if (key.escape) {
        setActionMode('none');
        setCmdInput('');
      } else if (key.tab) {
        setCmdInput(getPaletteSuggestions(cmdInput, appNames)[0] ?? cmdInput);
      } else if (key.return) {
        const parse = parsePaletteInput(cmdInput, appNames);
        if (parse) {
          props.onAction(parse);
        }
        setActionMode('none');
        setCmdInput('');
      } else if (key.backspace || key.delete) {
        setCmdInput(s => s.slice(0, -1));
      } else if (input.length === 1 && input >= ' ') {
        setCmdInput(s => s + input);
      }
      return;
    }

    // 3. Confirm overlay modes
    if (actionMode === 'confirm-restart' || actionMode === 'confirm-stop' || actionMode === 'confirm-rollback') {
      if (input === 'y' || key.return) {
        if (selectedApp) {
          if (actionMode === 'confirm-restart') {
            props.onAction({ type: 'restart', appName: selectedApp.app.name });
          } else if (actionMode === 'confirm-stop') {
            props.onAction({ type: 'stop', appName: selectedApp.app.name });
          } else if (actionMode === 'confirm-rollback') {
            const activeBuildIdx = selectedApp.app.builds?.findIndex(b => b === selectedApp.app.activeBuild) ?? -1;
            if (deployCursor !== activeBuildIdx) {
              props.onAction({ type: 'rollback', appName: selectedApp.app.name, rollbackIndex: deployCursor });
            }
          }
        }
        setActionMode('none');
      } else if (input === 'n' || key.escape) {
        setActionMode('none');
      }
      return;
    }

    // 4. Filter active mode
    if (filterActive) {
      if (key.escape) {
        setFilterQuery('');
        setFilterActive(false);
      } else if (key.backspace || key.delete) {
        setFilterQuery(s => s.slice(0, -1));
      } else if (input.length === 1 && input >= ' ') {
        setFilterQuery(s => s + input);
      }
      return;
    }

    // 5. Normal navigation
    if (input === '/') {
      // On Logs tab, / is reserved for "grep logs" (deferred feature) — don't steal it for filter
      if (tab !== 'logs') {
        setFilterActive(true);
      }
    } else if (input === ':') {
      setActionMode('cmd-palette');
    } else if (input === 'q') {
      props.onQuit();
      exit();
    } else if (key.upArrow || input === 'k') {
      if (tab === 'deploys') {
        setDeployCursor(d => Math.max(0, d - 1));
      } else {
        setCursor(c => Math.max(0, c - 1));
      }
    } else if (key.downArrow || input === 'j') {
      if (tab === 'deploys') {
        setDeployCursor(d => Math.min((selectedApp?.app.builds?.length ?? 1) - 1, d + 1));
      } else {
        setCursor(c => Math.min(filteredApps.length - 1, c + 1));
      }
    } else if (key.tab || input === 'l') {
      setTab(t => TABS[(TABS.indexOf(t) + 1) % TABS.length]);
    } else if (input === 'h') {
      setTab(t => TABS[(TABS.indexOf(t) - 1 + TABS.length) % TABS.length]);
    } else if (input === 'r') {
      if (selectedApp) setActionMode('confirm-restart');
    } else if (input === 'S') {
      if (selectedApp) setActionMode('confirm-stop');
    } else if (input === 'D') {
      if (selectedApp) props.onAction({ type: 'deploy', appName: selectedApp.app.name });
    } else if (input === 'E') {
      if (selectedApp) props.onAction({ type: 'env', appName: selectedApp.app.name });
    } else if (input === 'L') {
      if (selectedApp) props.onAction({ type: 'logs', appName: selectedApp.app.name });
    } else if (key.return && tab === 'deploys') {
      if (selectedApp) {
        const activeBuildIdx = selectedApp.app.builds?.findIndex(b => b === selectedApp.app.activeBuild) ?? -1;
        if (deployCursor !== activeBuildIdx) {
          // Open confirm dialog instead of rolling back immediately
          setActionMode('confirm-rollback');
        }
      }
    } else if (key.return && tab === 'domains') {
      if (selectedApp) {
        props.onAction({ type: 'view-nginx-config', appName: selectedApp.app.name });
      }
    }
  });

  // ── Layout values ──────────────────────────────────────────────────────────
  const pm2Reachable = props.state?.pm2Reachable ?? false;
  const dbReachable = props.state?.dbReachable ?? false;
  const sshReachable = props.state?.sshReachable;
  const sshHost = props.state?.sshHost;
  const totalMemBytes = props.state?.totalMemBytes;
  const cpuHistory = selectedApp ? (cpuHistories.current.get(selectedApp.app.name) ?? []) : [];
  const memHistory = selectedApp ? (memHistories.current.get(selectedApp.app.name) ?? []) : [];

  return (
    <Box flexDirection="column" width={TERM_W}>
      <TopBar pm2Reachable={pm2Reachable} dbReachable={dbReachable} sshReachable={sshReachable} sshHost={sshHost} />
      <FilterBar active={filterActive} query={filterQuery} />

      {/* Main split */}
      <Box flexDirection="row">
        {/* Left: App list */}
        <AppList apps={filteredApps} cursor={cursor} />

        {/* Right: Detail pane */}
        <Box flexDirection="column" width={DETAIL_W}>
          {selectedApp ? (
            <>
              <DetailHeader app={selectedApp} />
              <TabBar active={tab} />
              {/* Active tab content */}
              {tab === 'overview' && <OverviewTab data={selectedApp} />}
              {tab === 'metrics' && <MetricsTab data={selectedApp} cpuHistory={cpuHistory} memHistory={memHistory} totalMemBytes={totalMemBytes} />}
              {tab === 'logs' && <LogsTab logLines={props.logLines} />}
              {tab === 'deploys' && <DeploysTab data={selectedApp} deployCursor={deployCursor} onAction={props.onAction} />}
              {tab === 'domains' && <DomainsTab data={selectedApp} />}
            </>
          ) : (
            <Box flexDirection="column">
              <DetailHeader app={null} />
              {props.loading && <Text dimColor>Loading…</Text>}
              {!props.loading && apps.length === 0 && <Text dimColor>No apps found. Run `dm init` to add one.</Text>}
            </Box>
          )}
        </Box>
      </Box>

      {/* Overlays */}
      {toastAppName && (
        <CrashLoopToast
          appName={toastAppName}
          restartCount={selectedApp?.restartDelta ?? 0}
          tickCount={toastTick}
          onDismiss={() => { setToastAppName(null); setToastTick(0); }}
        />
      )}
      {actionMode === 'cmd-palette' && (
        <CommandPalette
          input={cmdInput}
          appNames={appNames}
        />
      )}
      {(actionMode === 'confirm-restart' || actionMode === 'confirm-stop' || actionMode === 'confirm-rollback') && selectedApp && (
        <ConfirmDialog
          title={
            actionMode === 'confirm-restart' ? `Restart ${selectedApp.app.name}` :
            actionMode === 'confirm-stop' ? `Stop ${selectedApp.app.name}` :
            `Rollback ${selectedApp.app.name}`
          }
          description={
            actionMode === 'confirm-restart' ? 'This will restart the process.' :
            actionMode === 'confirm-stop' ? 'This will stop the process.' :
            `Roll back to build #${deployCursor}? The current build will be replaced.`
          }
        />
      )}

      <Keybar activeTab={tab} />
    </Box>
  );
}
