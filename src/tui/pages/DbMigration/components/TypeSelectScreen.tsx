import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { TypeSelectScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';

export const TypeSelectScreen: React.FC<TypeSelectScreenProps> = ({
  onSelect,
  onCancel,
}) => {
  const [selected, setSelected] = useState<'generated' | 'manual'>('generated');
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      exit();
      return;
    }

    if (key.upArrow) {
      setSelected('generated');
    } else if (key.downArrow) {
      setSelected('manual');
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
        <Box borderStyle="single" borderTop>
          <Text dimColor>↑↓ choose · ↵ continue · Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
};
