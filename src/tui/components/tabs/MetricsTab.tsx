import React from 'react';
import { Box, Text } from 'ink';
import type { AppSummary, AppDetail } from '../../../utils/dashboard-data.js';
import type { LogEntry } from '../../../utils/nginx-log-tailer.js';
import { DETAIL_W, fmtMem, pad, truncate, sparkline } from '../shared.js';

interface MetricsTabProps {
  summary: AppSummary;
  detail: AppDetail | null;
  cpuHistory: number[];
  memHistory: number[];
  totalMemBytes?: number;
  maxVisible: number;
  scrollOffset: number;
  metricsView: 'stats' | 'logs';
}

// ─── Nginx log entry renderer ─────────────────────────────────────────────────

function statusColor(code: number): string {
  if (code >= 500) return 'red';
  if (code >= 400) return 'yellow';
  if (code >= 300) return 'cyan';
  return 'green';
}

function fmtTs(ts: Date): string {
  const h = String(ts.getHours()).padStart(2, '0');
  const m = String(ts.getMinutes()).padStart(2, '0');
  const s = String(ts.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}b`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}k`;
  return `${(b / 1024 / 1024).toFixed(1)}M`;
}

function NginxLogLine({
  entry,
  width,
}: {
  entry: LogEntry;
  width: number;
}): React.ReactElement {
  const ts = fmtTs(entry.ts);
  const method = pad(entry.method, 4);
  const status = String(entry.status);
  const rt =
    entry.responseTime !== undefined
      ? `${(entry.responseTime * 1000).toFixed(0)}ms`
      : '';
  const bytes = fmtBytes(entry.bytes);
  const addr = entry.remoteAddr || '';
  // Reserve space: ts(8) + method(5) + status(4) + rt(7) + bytes(6) + addr(16) + gaps = ~50
  const uriWidth = Math.max(8, width - 50);
  const uri = truncate(entry.uri, uriWidth);
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>{ts}</Text>
      {addr ? <Text color="cyan">{addr}</Text> : null}
      <Text dimColor>{method}</Text>
      <Text color={statusColor(entry.status)}>{status}</Text>
      <Text>{uri}</Text>
      {rt ? <Text dimColor>{rt}</Text> : null}
      <Text dimColor>{bytes}</Text>
    </Box>
  );
}

// ─── Logs sub-view ────────────────────────────────────────────────────────────

function NginxLogsView({
  detail,
  scrollOffset,
  maxVisible,
}: {
  detail: AppDetail | null;
  scrollOffset: number;
  maxVisible: number;
}): React.ReactElement {
  if (!detail) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>loading…</Text>
      </Box>
    );
  }

  // Collect all entries across all domains/routes, sorted newest-first
  const allEntries: LogEntry[] = [];
  for (const domain of detail.domains) {
    for (const route of domain.routes) {
      if (route.nginxLog?.recentEntries) {
        allEntries.push(...route.nginxLog.recentEntries);
      }
    }
  }

  if (allEntries.length === 0) {
    const hasUnpushed = detail.domains.some((d) => !d.lastPushedAt);
    const isLoading = detail.domains.some((d) =>
      d.routes.some((r) => r.nginxLog?.loading)
    );
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>
          {isLoading
            ? 'loading…'
            : hasUnpushed
              ? 'not pushed to Nginx — no access logs available'
              : 'no requests recorded yet'}
        </Text>
      </Box>
    );
  }

  // Sort chronologically (oldest first) — same as LogsTab scroll model
  allEntries.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const contentRows = Math.max(1, maxVisible - 3); // header + hint rows
  const total = allEntries.length;
  // scrollOffset=0 → tail; PgUp increases offset → scroll back in history
  // Clamp so we never scroll past the first line
  const maxOffset = Math.max(0, total - contentRows);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const end = Math.max(0, total - clampedOffset);
  const start = Math.max(0, end - contentRows);
  const visible = allEntries.slice(start, end);

  return (
    <Box flexDirection="column" width={DETAIL_W}>
      <Box flexDirection="row" justifyContent="space-between" width={DETAIL_W}>
        <Text dimColor>
          nginx access log — {total} entries
          {total > contentRows ? ` (${start + 1}–${end})` : ''}
          {clampedOffset > 0 ? '  ↑ scrolled' : '  ↓ live'}
        </Text>
        <Text dimColor>PgUp/PgDn scroll</Text>
      </Box>
      {visible.map((entry, i) => (
        <Box key={`${entry.ts.getTime()}-${i}`}>
          <NginxLogLine entry={entry} width={DETAIL_W} />
        </Box>
      ))}
    </Box>
  );
}

// ─── Stats sub-view ───────────────────────────────────────────────────────────

function StatsView({
  summary,
  detail,
  cpuHistory,
  memHistory,
  totalMemBytes,
  maxVisible,
}: Pick<
  MetricsTabProps,
  | 'summary'
  | 'detail'
  | 'cpuHistory'
  | 'memHistory'
  | 'totalMemBytes'
  | 'maxVisible'
>): React.ReactElement {
  const { pm2, pm2Error, restartDelta } = summary;
  const domains = detail?.domains ?? [];

  function gaugeBar(f: number, w = 10): string {
    const n = Math.round(Math.max(0, Math.min(1, f)) * w);
    return '█'.repeat(n) + '░'.repeat(w - n);
  }

  const cpuStr = sparkline(cpuHistory, 20);
  const cpuVal = pm2Error
    ? pm2Error
    : !pm2
      ? 'PM2 unreachable'
      : `${pm2.cpu.toFixed(1)}%`;

  const memStr = sparkline(memHistory, 20);
  const memVal =
    pm2Error || !pm2 ? (pm2Error ?? 'PM2 unreachable') : fmtMem(pm2.memBytes);
  const memFrac = pm2 && totalMemBytes ? pm2.memBytes / totalMemBytes : 0;
  const showGauge = !!(pm2 && totalMemBytes);

  const hasDomains = domains.length > 0;

  return (
    <Box
      flexDirection="column"
      width={DETAIL_W}
      height={maxVisible}
      gap={1}
      overflow="hidden"
    >
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{pad('CPU:', 8)}</Text>
        <Text color="green">{cpuStr}</Text>
        <Text> </Text>
        {pm2Error || !pm2 ? (
          <Text dimColor>{cpuVal}</Text>
        ) : (
          <Text>{cpuVal}</Text>
        )}
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text dimColor>{pad('Memory:', 8)}</Text>
        <Text color="blue">{memStr}</Text>
        <Text> </Text>
        {pm2Error || !pm2 ? (
          <Text dimColor>{memVal}</Text>
        ) : (
          <>
            <Text>{memVal}</Text>
            {showGauge && (
              <>
                <Text> </Text>
                <Text dimColor>[</Text>
                <Text
                  color={
                    memFrac > 0.85 ? 'red' : memFrac > 0.6 ? 'yellow' : 'green'
                  }
                >
                  {gaugeBar(memFrac)}
                </Text>
                <Text dimColor>]</Text>
              </>
            )}
          </>
        )}
      </Box>

      {restartDelta >= 3 && (
        <Box flexDirection="row" gap={1}>
          <Text color="yellow">⚠</Text>
          <Text color="yellow">
            {restartDelta} restarts since dashboard opened
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Text dimColor>Request metrics</Text>
        {detail === null ? (
          <Box marginLeft={2}>
            <Text dimColor>loading…</Text>
          </Box>
        ) : !hasDomains ? (
          <Box marginLeft={2}>
            <Text dimColor>
              No domain routed to this app — request metrics require a proxied
              domain
            </Text>
          </Box>
        ) : (
          domains.map((domain) =>
            domain.routes.map((route) => (
              <Box
                key={`${domain.name}:${route.path}`}
                flexDirection="column"
                marginTop={1}
                marginLeft={2}
              >
                <Text bold>
                  {truncate(domain.name, DETAIL_W - 10)}
                  <Text dimColor>{'/' + route.path.replace(/^\//, '')}</Text>
                </Text>

                {!domain.lastPushedAt && (
                  <Box marginLeft={2}>
                    <Text dimColor>
                      not pushed to Nginx — no request metrics available
                    </Text>
                  </Box>
                )}

                {domain.lastPushedAt &&
                  (!route.nginxLog || !route.nginxLog.hasData) && (
                    <Box marginLeft={2} flexDirection="column">
                      {route.nginxLog?.loading ? (
                        <Text dimColor>loading…</Text>
                      ) : route.nginxLog?.error ? (
                        <Text color="red">
                          log error —{' '}
                          {truncate(route.nginxLog.error, DETAIL_W - 14)}
                        </Text>
                      ) : (
                        <Text dimColor>
                          no requests recorded yet — metrics will appear once
                          traffic flows
                        </Text>
                      )}
                      {route.nginxLog && !route.nginxLog.loading && (
                        <Text dimColor>
                          {' '}
                          path:{' '}
                          {truncate(route.nginxLog.logPath, DETAIL_W - 10)}
                        </Text>
                      )}
                      {route.nginxLog?.rawSample && (
                        <Text dimColor>
                          {' '}
                          raw:{' '}
                          {truncate(
                            route.nginxLog.rawSample.replace(/\n/g, '↵'),
                            DETAIL_W - 8
                          )}
                        </Text>
                      )}
                      {route.nginxLog &&
                        !route.nginxLog.loading &&
                        !route.nginxLog.error &&
                        !route.nginxLog.rawSample && (
                          <Text dimColor> (file read returned empty)</Text>
                        )}
                    </Box>
                  )}

                {domain.lastPushedAt && route.nginxLog?.hasData && (
                  <Box flexDirection="column" marginLeft={2}>
                    <Box flexDirection="row" gap={1}>
                      <Text dimColor>{pad('req/s:', 8)}</Text>
                      <Text color="yellow">
                        {route.nginxLog.reqPerSec.toFixed(1)}
                      </Text>
                    </Box>
                    <Box flexDirection="row" gap={2}>
                      <Text dimColor>status:</Text>
                      <Text color="green">
                        2XX {route.nginxLog.statusDist.s2xx}
                      </Text>
                      <Text color="yellow">
                        4XX {route.nginxLog.statusDist.s4xx}
                      </Text>
                      <Text color="red">
                        5XX {route.nginxLog.statusDist.s5xx}
                      </Text>
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
                      <Text dimColor>
                        response times unavailable — regenerate nginx config for
                        dm_json format
                      </Text>
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

// ─── MetricsTab ───────────────────────────────────────────────────────────────

export function MetricsTab({
  summary,
  detail,
  cpuHistory,
  memHistory,
  totalMemBytes,
  maxVisible,
  scrollOffset,
  metricsView,
}: MetricsTabProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={DETAIL_W}
      height={maxVisible}
      overflow="hidden"
    >
      {/* Sub-view toggle bar */}
      <Box flexDirection="row" gap={2} marginBottom={1}>
        <Text
          bold={metricsView === 'stats'}
          color={metricsView === 'stats' ? 'yellow' : undefined}
          dimColor={metricsView !== 'stats'}
        >
          stats
        </Text>
        <Text dimColor>│</Text>
        <Text
          bold={metricsView === 'logs'}
          color={metricsView === 'logs' ? 'yellow' : undefined}
          dimColor={metricsView !== 'logs'}
        >
          access logs
        </Text>
        <Text dimColor> v to toggle</Text>
      </Box>

      {metricsView === 'stats' ? (
        <StatsView
          summary={summary}
          detail={detail}
          cpuHistory={cpuHistory}
          memHistory={memHistory}
          totalMemBytes={totalMemBytes}
          maxVisible={maxVisible - 2}
        />
      ) : (
        <NginxLogsView
          detail={detail}
          scrollOffset={scrollOffset}
          maxVisible={maxVisible - 2}
        />
      )}
    </Box>
  );
}
