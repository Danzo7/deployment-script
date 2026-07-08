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
  const contentRows = Math.max(1, maxVisible - 1);

  if (logLines.length === 0) {
    return (
      <Box width={DETAIL_W} flexDirection="column" height={maxVisible}>
        <Text dimColor>No log output captured yet. Logs stream in as the app produces them.</Text>
        <Text dimColor>Press X to clear logs.</Text>
      </Box>
    );
  }

  const total = logLines.length;
  const start = Math.max(0, total - contentRows - scrollOffset);
  const end = Math.max(0, total - scrollOffset);
  const parsed = logLines.slice(start, end).map(parseLogLine);

  return (
    <Box flexDirection="column" width={DETAIL_W} height={maxVisible}>
      <Box flexDirection="row" justifyContent="space-between" width={DETAIL_W}>
        <Text dimColor>
          {total} lines{total > contentRows ? ` (showing ${start + 1}–${end})` : ''}
          {scrollOffset > 0 ? '  ↑ scrolled' : ''}
        </Text>
        <Text dimColor>X clear  PgUp/PgDn scroll</Text>
      </Box>
      {parsed.map((e, i) => {
        const ts = e.timestamp ? `${e.timestamp} ` : '';
        if (e.severity === 'error') return <Text key={i} color="red">{ts}{'✕ '}{e.message}</Text>;
        if (e.severity === 'warn') return (
          <Box key={i} flexDirection="row">
            {ts !== '' && <Text>{ts}</Text>}
            <Text color="yellow">{'! '}</Text>
            <Text>{e.message}</Text>
          </Box>
        );
        return <Text key={i} dimColor>{ts}{'· '}{e.message}</Text>;
      })}
    </Box>
  );
}
