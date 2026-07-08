import React from 'react';
import { Box, Text } from 'ink';
import type { DetailTab } from './shared.js';
import { TERM_W } from './shared.js';

interface HintProps { label: string; desc: string; }
function Hint({ label, desc }: HintProps): React.ReactElement {
  return (
    <>
      <Text bold color="white">{label}</Text>
      <Text dimColor>{` ${desc}  `}</Text>
    </>
  );
}

interface KeybarProps { activeTab: DetailTab; }

export function Keybar({ activeTab }: KeybarProps): React.ReactElement {
  const tabHints = (() => {
    switch (activeTab) {
      case 'overview':
        return <><Hint label="r" desc="restart" /><Hint label="S" desc="stop" /><Hint label="D" desc="redeploy" /><Hint label="E" desc="env" /></>;
      case 'metrics':
        return <><Hint label="v" desc="toggle logs" /><Hint label="c" desc="copy value" /></>;
      case 'logs':
        return <><Hint label="X" desc="clear" /><Hint label="c" desc="copy line" /></>;
      case 'deploys':
        return <><Hint label="↵" desc="rollback" /><Hint label="c" desc="copy commit" /></>;
      case 'domains':
        return <><Hint label="↵" desc="nginx config" /><Hint label="c" desc="copy url" /></>;
    }
  })();

  return (
    <Box flexDirection="column" width={TERM_W}>
      <Text dimColor>{'─'.repeat(TERM_W)}</Text>
      <Box flexDirection="row">
        <Hint label="Tab" desc="switch tab" />
        <Hint label="PgUp/PgDn" desc="scroll" />
        <Hint label="Esc" desc="dismiss" />
        <Hint label="q" desc="quit" />
        {tabHints}
      </Box>
    </Box>
  );
}
