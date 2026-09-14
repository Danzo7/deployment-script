import React from 'react';
import { Box, Text } from 'ink';
import type { SessionSnapshot } from '../../../../utils/ssh-server.js';
import { pad, fmtElapsed } from '../../../utils/formatters.js';
import { TERM_W } from '../../../utils/constants.js';

interface SessionsTableProps {
  sessions: SessionSnapshot[];
  cursor: number;
  maxVisible: number;
}

const COL_ID = 8;
const COL_USER = 20;
const COL_IP = 18;
const COL_TYPE = 12;
const COL_UPTIME = 12;

export function SessionsTable({
  sessions,
  cursor,
  maxVisible,
}: SessionsTableProps): React.ReactElement {
  // Calculate scroll offset to keep cursor visible
  const visibleStart = Math.max(0, cursor - Math.floor(maxVisible / 2));
  const visibleEnd = Math.min(sessions.length, visibleStart + maxVisible);
  const visibleSessions = sessions.slice(visibleStart, visibleEnd);
  const adjustedCursor = cursor - visibleStart;

  return (
    <Box flexDirection="column" width={TERM_W}>
      {/* Header */}
      <Box flexDirection="row" gap={1} marginBottom={0}>
        <Text bold color="yellow">
          Active Sessions
        </Text>
        <Text dimColor>
          ({sessions.length} {sessions.length === 1 ? 'session' : 'sessions'})
        </Text>
      </Box>

      {/* Column headers */}
      <Box flexDirection="row" marginTop={1}>
        <Text dimColor>  </Text>
        <Text dimColor bold>
          {pad('ID', COL_ID)}
        </Text>
        <Text dimColor bold>
          {pad('User', COL_USER)}
        </Text>
        <Text dimColor bold>
          {pad('IP Address', COL_IP)}
        </Text>
        <Text dimColor bold>
          {pad('Type', COL_TYPE)}
        </Text>
        <Text dimColor bold>
          {pad('Uptime', COL_UPTIME)}
        </Text>
      </Box>
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>

      {/* Session rows */}
      {sessions.length === 0 ? (
        <Box marginTop={2} marginLeft={2}>
          <Text dimColor>No active sessions</Text>
          <Text dimColor> </Text>
          <Text dimColor>Waiting for connections...</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visibleSessions.map((s, i) => {
            const selected = i === adjustedCursor;
            const isShell = s.sessionType === 'shell';
            
            return (
              <Box key={s.id} flexDirection="row">
                {selected ? (
                  <Text bold color="yellow">
                    ▸{' '}
                  </Text>
                ) : (
                  <Text>{'  '}</Text>
                )}
                <Text color={selected ? 'yellow' : 'white'} bold={selected}>
                  {pad(s.id, COL_ID)}
                </Text>
                <Text color={selected ? 'yellow' : 'white'} bold={selected}>
                  {pad(s.identity, COL_USER)}
                </Text>
                <Text color={selected ? 'yellow' : 'gray'}>
                  {pad(s.ip, COL_IP)}
                </Text>
                <Text color={isShell ? 'cyan' : 'green'}>
                  {pad(s.sessionType, COL_TYPE)}
                </Text>
                <Text dimColor>{fmtElapsed(s.connectedAt)}</Text>
              </Box>
            );
          })}
          
          {/* Scroll indicator */}
          {sessions.length > maxVisible && (
            <Box marginTop={1}>
              <Text dimColor>
                Showing {visibleStart + 1}-{visibleEnd} of {sessions.length}
                {' '}(use ↑↓ to scroll)
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
