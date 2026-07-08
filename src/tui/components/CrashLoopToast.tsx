import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { TERM_W, TOAST_TTL_TICKS } from './shared.js';

interface CrashLoopToastProps {
  appName: string;
  restartCount: number;
  tickCount: number;
  onDismiss: () => void;
}

export function CrashLoopToast({ appName, restartCount, tickCount, onDismiss }: CrashLoopToastProps): React.ReactElement {
  useEffect(() => {
    if (tickCount >= TOAST_TTL_TICKS) onDismiss();
  }, [tickCount, onDismiss]);

  return (
    <Box flexDirection="row" width={TERM_W}>
      <Text color="yellow">▌ ⚠ </Text>
      <Text>{appName} has restarted {restartCount} {restartCount === 1 ? 'time' : 'times'}</Text>
      <Text dimColor>  L to view logs</Text>
    </Box>
  );
}
