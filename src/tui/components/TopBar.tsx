import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';

interface TopBarProps {
  pm2Reachable: boolean;
  dbReachable: boolean;
  sshReachable?: boolean;
  sshHost?: string;
}

export function TopBar({ pm2Reachable, dbReachable, sshReachable, sshHost }: TopBarProps): React.ReactElement {
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 8));

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toTimeString().slice(0, 8)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column" width={TERM_W}>
      <Box flexDirection="row" justifyContent="space-between" width={TERM_W}>
        <Box flexDirection="row" gap={2}>
          <Text bold color="yellow">dm</Text>
          <Box flexDirection="row" gap={0}>
            <Text color={pm2Reachable ? 'green' : 'red'}>●</Text>
            <Text> pm2</Text>
          </Box>
          <Box flexDirection="row" gap={0}>
            <Text color={dbReachable ? 'green' : 'red'}>●</Text>
            <Text> db</Text>
          </Box>
          {sshHost != null && (
            <Box flexDirection="row" gap={0}>
              <Text color={sshReachable ? 'green' : 'yellow'}>●</Text>
              <Text> ssh:{sshHost}</Text>
            </Box>
          )}
        </Box>
        <Text>{time}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>
    </Box>
  );
}
