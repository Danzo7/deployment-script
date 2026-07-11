import React from 'react';
import { Box, Text } from 'ink';
import type {
  AppSummary,
  AppDetail,
  VcsDriftInfo,
} from '../../../utils/dashboard-data.js';
import type { DomainInfo } from '../../../utils/dashboard-data.js';
import {
  DETAIL_W,
  fmtMem,
  fmtUptime,
  fmtDate,
  truncate,
  pad,
} from '../shared.js';

interface OverviewTabProps {
  summary: AppSummary;
  detail: AppDetail | null;
}

export function OverviewTab({
  summary,
  detail,
}: OverviewTabProps): React.ReactElement {
  const { app, pm2 } = summary;
  const drift: VcsDriftInfo | null = detail?.drift ?? null;
  const domains: DomainInfo[] = detail?.domains ?? [];
  const envChanged = detail?.envChanged;
  const portReachable = detail?.portReachable;

  function vcsStatus():
    | 'up-to-date'
    | 'behind'
    | 'ahead'
    | 'diverged'
    | 'unknown' {
    if (!drift) return 'unknown';
    if (drift.behind > 0 && drift.ahead > 0) return 'diverged';
    if (drift.behind > 0) return 'behind';
    if (drift.ahead > 0) return 'ahead';
    return 'up-to-date';
  }
  function vcsColor(s: ReturnType<typeof vcsStatus>): string {
    return s === 'up-to-date'
      ? 'green'
      : s === 'diverged'
        ? 'red'
        : s === 'unknown'
          ? 'gray'
          : 'yellow';
  }
  function vcsLabel(s: ReturnType<typeof vcsStatus>): string {
    return s === 'up-to-date' ? 'up to date' : s;
  }

  const firstCert = (() => {
    for (const d of domains) {
      if (d.cert.mode !== 'none') return d.cert;
    }
    return null;
  })();

  function certBadgeColor(days?: number): string {
    if (days === undefined) return 'gray';
    return days < 7 ? 'red' : days < 30 ? 'yellow' : 'green';
  }

  const status = vcsStatus();
  const commit = app.lastDeployedCommit;
  const shortHash = commit?.hash ? commit.hash.slice(0, 7) : '—';

  type RouteEntry = { url: string; sslLabel: string; certValid: boolean };
  const allRoutes: RouteEntry[] = [];
  for (const d of domains) {
    const protocol = d.cert.mode === 'none' ? 'http' : 'https';
    for (const r of d.routes) {
      const pathPart =
        r.path === '/' || r.path === '' ? '/' : `/${r.path.replace(/^\//, '')}`;
      let sslLabel = 'no SSL';
      if (d.cert.mode !== 'none') {
        if (d.cert.isExpired) sslLabel = 'SSL expired';
        else if (d.cert.expiringSoon)
          sslLabel = `SSL expires ${d.cert.daysRemaining}d`;
        else if (d.cert.daysRemaining !== undefined)
          sslLabel = `SSL valid · ${d.cert.daysRemaining}d`;
        else sslLabel = d.cert.mode;
      }
      allRoutes.push({
        url: `${protocol}://${d.name}${pathPart}`,
        sslLabel,
        certValid: !d.cert.isExpired && d.cert.mode !== 'none',
      });
    }
  }

  const KVItem = ({
    label,
    value,
    valueColor,
  }: {
    label: string;
    value: string;
    valueColor?: string;
  }) => (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>{pad(label + ':', 12)}</Text>
      {valueColor ? (
        <Text color={valueColor}>{truncate(value, DETAIL_W / 2 - 14)}</Text>
      ) : (
        <Text>{truncate(value, DETAIL_W / 2 - 14)}</Text>
      )}
    </Box>
  );

  const half = Math.floor(DETAIL_W / 2);

  return (
    <Box flexDirection="column" width={DETAIL_W} gap={1}>
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" width={half}>
          <KVItem label="Port" value={String(app.port)} />
          <KVItem label="Type" value={app.projectType ?? '—'} />
          <KVItem label="Instances" value={String(app.instances ?? 1)} />
          <KVItem label="Branch" value={drift?.branch ?? app.branch ?? '—'} />
          <KVItem
            label="Uptime"
            value={pm2?.status === 'online' ? fmtUptime(pm2.uptimeMs) : '—'}
          />
          <KVItem label="Exec Mode" value={pm2?.execMode ?? '—'} />
          <KVItem
            label="PID"
            value={pm2?.pid != null ? String(pm2.pid) : '—'}
          />
          {portReachable !== undefined && (
            <KVItem
              label="Port check"
              value={portReachable ? 'reachable' : 'unreachable'}
              valueColor={portReachable ? 'green' : 'red'}
            />
          )}
        </Box>
        <Box flexDirection="column" width={half}>
          <KVItem label="Commit" value={shortHash} valueColor="yellow" />
          <KVItem label="Deployed" value={fmtDate(app.lastDeploy)} />
          <KVItem label="Restarts" value={String(pm2?.restarts ?? 0)} />
          <KVItem
            label="Active Build"
            value={
              app.activeBuild
                ? (app.activeBuild
                    .replace(/[/\\]+$/, '')
                    .split(/[/\\]/)
                    .pop() ?? '—') +
                  (app.builds?.length ? ` (${app.builds.length})` : '')
                : '—'
            }
          />
          <KVItem label="Script" value={pm2?.scriptPath ?? '—'} />
        </Box>
      </Box>

      <Box flexDirection="row" gap={2}>
        <Text color={vcsColor(status)}>[{vcsLabel(status)}]</Text>
        {firstCert ? (
          <Text color={certBadgeColor(firstCert.daysRemaining)}>
            {firstCert.daysRemaining !== undefined
              ? `[cert ${firstCert.daysRemaining}d]`
              : '[cert —]'}
          </Text>
        ) : (
          <Text dimColor>[no cert]</Text>
        )}
        {envChanged === true && <Text color="yellow">[env changed]</Text>}
      </Box>

      {detail === null && (
        <Box>
          <Text dimColor>loading detail…</Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Text dimColor>Last commit</Text>
        <Box marginLeft={2}>
          <Text dimColor>{truncate(commit?.message ?? '—', DETAIL_W - 4)}</Text>
        </Box>
        <Box flexDirection="row" gap={2} marginLeft={2}>
          <Text>{commit?.author ?? '—'}</Text>
          <Text dimColor>
            {commit?.date ? fmtDate(new Date(commit.date)) : '—'}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column">
        <Text dimColor>Routes</Text>
        {allRoutes.length === 0 ? (
          <Box marginLeft={2}>
            <Text dimColor>
              {detail === null ? 'loading…' : 'No routes configured'}
            </Text>
          </Box>
        ) : (
          allRoutes.map((r, i) => (
            <Box key={i} flexDirection="row" gap={1} marginLeft={2}>
              <Text color="magenta">{truncate(r.url, DETAIL_W - 20)}</Text>
              <Text
                dimColor
                color={
                  r.certValid
                    ? 'green'
                    : r.sslLabel === 'no SSL'
                      ? undefined
                      : 'yellow'
                }
              >
                {r.sslLabel}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
