import React from 'react';
import { Box, Text } from 'ink';
import type { AppSummary, AppDetail } from '../../../utils/dashboard-data.js';
import { DETAIL_W, fmtMem, pad, truncate, sparkline } from '../shared.js';

interface MetricsTabProps {
  summary: AppSummary;
  detail: AppDetail | null;
  cpuHistory: number[];
  memHistory: number[];
  totalMemBytes?: number;
  maxVisible: number;
  scrollOffset: number;
}

export function MetricsTab({ summary, detail, cpuHistory, memHistory, totalMemBytes, maxVisible }: MetricsTabProps): React.ReactElement {
  const { pm2, pm2Error, restartDelta } = summary;
  const domains = detail?.domains ?? [];

  function gaugeBar(f: number, w = 10): string {
    const n = Math.round(Math.max(0, Math.min(1, f)) * w);
    return '█'.repeat(n) + '░'.repeat(w - n);
  }

  const cpuStr = sparkline(cpuHistory, 20);
  const cpuVal = pm2Error ? pm2Error : !pm2 ? 'PM2 unreachable' : `${pm2.cpu.toFixed(1)}%`;

  const memStr = sparkline(memHistory, 20);
  const memVal = pm2Error || !pm2 ? (pm2Error ?? 'PM2 unreachable') : fmtMem(pm2.memBytes);
  const memFrac = pm2 && totalMemBytes ? pm2.memBytes / totalMemBytes : 0;
  const showGauge = !!(pm2 && totalMemBytes);

  const hasDomains = domains.length > 0;

  return (
    <Box flexDirection="column" width={DETAIL_W} height={maxVisible} gap={1} overflow="hidden">
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{pad('CPU:', 8)}</Text>
        <Text color="green">{cpuStr}</Text>
        <Text> </Text>
        {pm2Error || !pm2 ? <Text dimColor>{cpuVal}</Text> : <Text>{cpuVal}</Text>}
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text dimColor>{pad('Memory:', 8)}</Text>
        <Text color="blue">{memStr}</Text>
        <Text> </Text>
        {pm2Error || !pm2 ? <Text dimColor>{memVal}</Text> : (
          <>
            <Text>{memVal}</Text>
            {showGauge && (
              <>
                <Text> </Text>
                <Text dimColor>[</Text>
                <Text color={memFrac > 0.85 ? 'red' : memFrac > 0.6 ? 'yellow' : 'green'}>{gaugeBar(memFrac)}</Text>
                <Text dimColor>]</Text>
              </>
            )}
          </>
        )}
      </Box>

      {restartDelta >= 3 && (
        <Box flexDirection="row" gap={1}>
          <Text color="yellow">⚠</Text>
          <Text color="yellow">{restartDelta} restarts since dashboard opened</Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Text dimColor>Request metrics</Text>
        {detail === null ? (
          <Box marginLeft={2}><Text dimColor>loading…</Text></Box>
        ) : !hasDomains ? (
          <Box marginLeft={2}><Text dimColor>No domain routed to this app — request metrics require a proxied domain</Text></Box>
        ) : (
          domains.map((domain) =>
            domain.routes.map((route) => (
              <Box key={`${domain.name}:${route.path}`} flexDirection="column" marginTop={1} marginLeft={2}>
                <Text bold>{truncate(domain.name, DETAIL_W - 10)}<Text dimColor>{'/' + route.path.replace(/^\//, '')}</Text></Text>

                {!domain.lastPushedAt && (
                  <Box marginLeft={2}><Text dimColor>not pushed to Nginx — no request metrics available</Text></Box>
                )}

                {domain.lastPushedAt && (!route.nginxLog || !route.nginxLog.hasData) && (
                  <Box marginLeft={2}>
                    {route.nginxLog?.error
                      ? <Text dimColor>log unavailable — {truncate(route.nginxLog.error, DETAIL_W - 20)}</Text>
                      : <Text dimColor>no requests recorded yet — metrics will appear once traffic flows</Text>}
                  </Box>
                )}

                {domain.lastPushedAt && route.nginxLog?.hasData && (
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
                        {route.nginxLog.p95ms !== undefined && <Text>p95 {route.nginxLog.p95ms}ms</Text>}
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
