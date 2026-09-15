import React from 'react';
import { TERM_W } from '../../../utils/constants.js';
import { Keybar as UnifiedKeybar } from '../../../components/Keybar.js';

interface KeybarProps {
  hasActiveSessions: boolean;
}

export function Keybars({ hasActiveSessions }: KeybarProps): React.ReactElement {
  const hints = [
    ...(hasActiveSessions
      ? [
          { label: '↑↓', desc: 'select' },
          { label: 'D', desc: 'disconnect' },
        ]
      : []),
    { label: 'PgUp/PgDn', desc: 'scroll log' },
    { label: 'Q', desc: 'quit' },
  ];

  return <UnifiedKeybar hints={hints} width={TERM_W} />;
}
