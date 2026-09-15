import React from 'react';
import { Box, Text } from 'ink';
import type { DetailTab } from '../../pages/Dashboard/types.js';
import { TERM_W } from '../../utils/constants.js';
import { Keybar as UnifiedKeybar } from '../Keybar.js';

interface KeybarProps {
  activeTab: DetailTab;
}

export function Keybar({ activeTab }: KeybarProps): React.ReactElement {
  const baseHints = [
    { label: 'Tab', desc: 'switch tab' },
    { label: 'PgUp/PgDn', desc: 'scroll' },
    { label: 'Esc', desc: 'dismiss' },
    { label: 'q', desc: 'quit' },
  ];

  const tabHints = (() => {
    switch (activeTab) {
      case 'overview':
        return [
          { label: 'r', desc: 'restart' },
          { label: 'S', desc: 'stop' },
          { label: 'D', desc: 'redeploy' },
          { label: 'E', desc: 'env' },
        ];
      case 'metrics':
        return [
          { label: 'v', desc: 'toggle logs' },
          { label: 'c', desc: 'copy value' },
        ];
      case 'logs':
        return [
          { label: 'X', desc: 'clear' },
          { label: 'c', desc: 'copy line' },
        ];
      case 'deploys':
        return [
          { label: '↵', desc: 'rollback' },
          { label: 'c', desc: 'copy commit' },
        ];
      case 'domains':
        return [
          { label: '↵', desc: 'nginx config' },
          { label: 'c', desc: 'copy url' },
        ];
    }
  })();

  return <UnifiedKeybar hints={[...baseHints, ...tabHints]} width={TERM_W} />;
}
