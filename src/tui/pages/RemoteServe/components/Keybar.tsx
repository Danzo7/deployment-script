import React from 'react';
import { Box, Text } from 'ink';
import { TERM_W } from '../../../utils/constants.js';

interface KeybarProps {
  hasActiveSessions: boolean;
}

function Hint({ label, desc }: { label: string; desc: string }) {
  return (
    <>
      <Text bold color="white">
        {label}
      </Text>
      <Text dimColor>{` ${desc}  `}</Text>
    </>
  );
}

export function Keybar({ hasActiveSessions }: KeybarProps): React.ReactElement {
  return (
    <Box flexDirection="column" width={TERM_W}>
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>
      <Box flexDirection="row">
        {hasActiveSessions && (
          <>
            <Hint label="↑↓" desc="select" />
            <Hint label="D" desc="disconnect" />
          </>
        )}
        <Hint label="PgUp/PgDn" desc="scroll log" />
        <Hint label="Q" desc="quit" />
      </Box>
    </Box>
  );
}
