import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { fmtTime } from '../../../utils/formatters.js';
import { TERM_W } from '../../../utils/constants.js';

interface ServerTopBarProps {
  bindAddress: string;
  port: number;
  fingerprint: string;
}

export function ServerTopBar({
  bindAddress,
  port,
  fingerprint,
}: ServerTopBarProps): React.ReactElement {
  const [time, setTime] = useState(() => fmtTime(new Date()));

  useEffect(() => {
    const id = setInterval(() => setTime(fmtTime(new Date())), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column" width={TERM_W}>
      <Box flexDirection="row" justifyContent="space-between" width={TERM_W}>
        <Box flexDirection="row" gap={2}>
          <Text bold color="yellow">
            dm remote serve
          </Text>
          <Text dimColor>│</Text>
          <Text color="green">● running</Text>
          <Text dimColor>│</Text>
          <Text>
            {bindAddress}:{port}
          </Text>
        </Box>
        <Text dimColor>{time}</Text>
      </Box>
      <Box flexDirection="row" marginTop={0}>
        <Text dimColor>Host Key: </Text>
        <Text color="cyan">{fingerprint}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>
    </Box>
  );
}
