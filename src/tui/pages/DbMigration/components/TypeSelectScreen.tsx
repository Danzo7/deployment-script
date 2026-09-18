import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TypeSelectScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';
import { Keybar } from '../../../components/Keybar.js';

export const TypeSelectScreen: React.FC<TypeSelectScreenProps> = ({
  onSelect,
  onCancel,
}) => {
  const [selected, setSelected] = useState<'generated' | 'manual' | 'data'>('generated');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      const current = options.findIndex((o) => o.type === selected);
      const nextIndex = current > 0 ? current - 1 : options.length - 1;
      setSelected(options[nextIndex].type);
    } else if (key.downArrow) {
      const current = options.findIndex((o) => o.type === selected);
      const nextIndex = current < options.length - 1 ? current + 1 : 0;
      setSelected(options[nextIndex].type);
    } else if (key.return) {
      onSelect(selected);
    }
  });

  const options = [
    {
      type: 'generated' as const,
      title: 'Generated',
      description: 'paste/type the desired schema — we diff it for you',
    },
    {
      type: 'manual' as const,
      title: 'Manual',
      description: 'paste/type raw SQL to execute as-is',
    },
    {
      type: 'data' as const,
      title: 'Data',
      description: 'data-only migration (INSERT, UPDATE, DELETE)',
    },
  ];

  return (
    <Box flexDirection="column" height="100%" justifyContent="center" alignItems="center">
      <Box flexDirection="column" paddingX={2} width={60}>
        {/* Title bar */}
        <Box>
          <Text bold color={DB_COLORS.accent}>
            New Migration
          </Text>
        </Box>

        {/* Options */}
        <Box flexDirection="column">
          {options.map((option) => {
            const isSelected = selected === option.type;
            const marker = isSelected ? '▸' : '○';
            
            return (
              <Box key={option.type} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text color={isSelected ? DB_COLORS.accent : DB_COLORS.dim}>
                    {marker}{' '}
                  </Text>
                  <Text bold color={isSelected ? DB_COLORS.text : DB_COLORS.dim}>
                    {option.title}
                  </Text>
                </Box>
                <Box marginLeft={3}>
                  <Text dimColor>{option.description}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* Footer */}
        <Keybar
          hints={[
            { label: '↑↓', desc: 'choose' },
            { label: '↵', desc: 'continue' },
            { label: 'Esc', desc: 'cancel' },
          ]}
          width={60}
        />
      </Box>
    </Box>
  );
};
