import React from 'react';
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';

interface FilterBarProps {
  active: boolean;
  query: string;
}

export function FilterBar({
  active,
  query,
}: FilterBarProps): React.ReactElement {
  return (
    <Box flexDirection="row" justifyContent="space-between" width={TERM_W}>
      {active ? (
        <Text>
          {query}
          <Text bold color="yellow">
            █
          </Text>
        </Text>
      ) : (
        <Text dimColor>filter apps…</Text>
      )}
      <Text dimColor>{'/ search  : command  s sort'}</Text>
    </Box>
  );
}
