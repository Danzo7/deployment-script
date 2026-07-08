import React from 'react';
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';

interface ConfirmDialogProps { title: string; description: string; }

export function ConfirmDialog({ title, description }: ConfirmDialogProps): React.ReactElement {
  return (
    <Box flexDirection="column" alignSelf="center" width={Math.min(50, TERM_W - 4)} borderStyle="round" borderColor="red">
      <Text color="red">{title}</Text>
      <Text>{description}</Text>
      <Box flexDirection="row">
        <Text bold color="white">y</Text>
        <Text dimColor>{' confirm  '}</Text>
        <Text bold color="white">n</Text>
        <Text dimColor>{' cancel'}</Text>
      </Box>
    </Box>
  );
}
