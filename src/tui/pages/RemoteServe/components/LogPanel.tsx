import React from 'react';
import { Box, Text } from 'ink';
import type { LogEntry } from '../types.js';
import { fmtTime } from '../../../utils/formatters.js';
import { levelColor } from '../../../utils/colors.js';
import { TERM_W } from '../../../utils/constants.js';

interface LogPanelProps {
  logs: LogEntry[];
  scrollOffset: number;
  maxVisible: number;
}

export function LogPanel({
  logs,
  scrollOffset,
  maxVisible,
}: LogPanelProps): React.ReactElement {
  const contentRows = maxVisible - 2; // Account for header and separator
  const visibleLogs = logs.slice(
    Math.max(0, logs.length - contentRows - scrollOffset),
    logs.length - scrollOffset || undefined
  );

  return (
    <Box flexDirection="column" width={TERM_W}>
      {/* Header */}
      <Box flexDirection="row" gap={2}>
        <Text bold color="yellow">
          Event Log
        </Text>
        {scrollOffset > 0 && (
          <Text dimColor>(↑ {scrollOffset} lines — PgDn to return)</Text>
        )}
        {logs.length === 0 && <Text dimColor>(waiting for events...)</Text>}
      </Box>
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>

      {/* Log entries */}
      <Box flexDirection="column" minHeight={contentRows}>
        {visibleLogs.length === 0 ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>No events yet</Text>
          </Box>
        ) : (
          visibleLogs.map((entry, i) => (
            <Box key={i} flexDirection="row" gap={1}>
              <Text dimColor>{fmtTime(entry.ts)}</Text>
              <Text color={levelColor(entry.level)}>{entry.message}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
