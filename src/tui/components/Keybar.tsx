import React from 'react';
import { Box, Text } from 'ink';

interface HintProps {
  label: string;
  desc: string;
}

function Hint({ label, desc }: HintProps): React.ReactElement {
  return (
    <>
      <Text bold color="white">
        {label}
      </Text>
      <Text dimColor>{` ${desc}  `}</Text>
    </>
  );
}

interface KeybarProps {
  hints: Array<{ label: string; desc: string }>;
  width?: number;
}

/**
 * Unified keybar component for displaying keyboard shortcuts at the bottom of TUI screens
 */
export function Keybar({ hints, width }: KeybarProps): React.ReactElement {
  const barWidth = width ?? 80;
  
  return (
    <Box flexDirection="column" width={barWidth}>
      <Text dimColor>{'─'.repeat(barWidth)}</Text>
      <Box flexDirection="row">
        {hints.map((hint, idx) => (
          <Hint key={idx} label={hint.label} desc={hint.desc} />
        ))}
      </Box>
    </Box>
  );
}
