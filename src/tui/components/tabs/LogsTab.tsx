import React from 'react';
import { Box, Text } from 'ink';
import { DETAIL_W } from '../shared.js';

type LogSeverity = 'error' | 'warn' | 'info';
interface ParsedLogLine { timestamp: string; message: string; severity: LogSeverity; }

const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\s*(.*)/s;

function classifySeverity(line: string): LogSeverity {
  if (line.includes('[err]') || line.includes('Error') || line.includes('ERROR')) return 'error';
  if (line.includes('warn') || line.includes('WARN')) return 'warn';
  return 'info';
}

function parseLogLine(raw: string): ParsedLogLine {
  const m = LOG_TS_RE.exec(raw);
  return { timestamp: m ? m[1] : '', message: m ? m[2] : raw, severity: classifySeverity(raw) };
}

interface LogsTabProps {
  logLines: string[];
  scrollOffset: number;
  maxVisible: number;
}

export function LogsTab({ logLines, scrollOffset, maxVisible }: LogsTabProps): React.ReactElement {
  if (logLines.length === 0) {
    return (
      <Box flexDirection="column" width={DETAIL_W} height={maxVisible} overflow="hidden">
        <Box flexDirection="row" justifyContent="space-between" width={DETAIL_W}>
          <Text dimColor>pm2 log — 0 lines</Text>
          <Text dimColor>X clear</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>No log output captured yet. Logs stream in as the app produces them.</Text>
        </Box>
      </Box>
    );
  }

  const contentRows = Math.max(1, maxVisible - 3); // reserve header + hint rows like NginxLogsView
  const total = logLines.length;
  const maxOffset = Math.max(0, total - contentRows);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const end = Math.max(0, total - clampedOffset);
  const start = Math.max(0, end - contentRows);
  const parsed = logLines.slice(start, end).map(parseLogLine);

  return (
    <Box flexDirection="column" width={DETAIL_W} height={maxVisible} overflow="hidden">
      {/* Header row — pinned, never overwritten */}
      <Box flexDirection="row" justifyContent="space-between" width={DETAIL_W}>
        <Text dimColor>
          pm2 log — {total} {total === 1 ? 'line' : 'lines'}{total > contentRows ? ` (${start + 1}–${end})` : ''}
          {clampedOffset > 0 ? '  ↑ scrolled' : '  ↓ live'}
        </Text>
        <Text dimColor>X clear  PgUp/PgDn</Text>
      </Box>

      {parsed.map((e, i) => {
        const ts = e.timestamp ? `${e.timestamp} ` : '';
        if (e.severity === 'error') return (
          <Box key={i} flexDirection="row" gap={1}>
            <Text dimColor>{ts}</Text>
            <Text color="red">✕</Text>
            <Text color="red">{e.message}</Text>
          </Box>
        );
        if (e.severity === 'warn') return (
          <Box key={i} flexDirection="row" gap={1}>
            {ts !== '' && <Text dimColor>{ts}</Text>}
            <Text color="yellow">!</Text>
            <Text>{e.message}</Text>
          </Box>
        );
        return (
          <Box key={i} flexDirection="row" gap={1}>
            <Text dimColor>{ts}·</Text>
            <Text dimColor>{e.message}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
