import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ControlledTextInput as TextInput } from '../../../components/ControlledTextInput.js';
import { PlanReviewScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';
import { PlanStep } from '../../../../db-migration/plan-types.js';

export const PlanReviewScreen: React.FC<PlanReviewScreenProps> = ({
  dbName,
  plan,
  mode,
  migrationKey: initialKey,
  onExecute,
  onBack,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [migrationKey, setMigrationKey] = useState(initialKey || '');
  const [editingKey, setEditingKey] = useState(false);
  const { exit } = useApp();

  const getHazardGlyph = (level: string) => {
    switch (level) {
      case 'destructive':
        return { glyph: '✗', color: DB_COLORS.red, label: 'dngr' };
      case 'warning':
        return { glyph: '⚠', color: DB_COLORS.yellow, label: 'warn' };
      default:
        return { glyph: '✓', color: DB_COLORS.green, label: 'none' };
    }
  };

  useInput((input, key) => {
    if (editingKey) {
      if (key.escape) {
        setEditingKey(false);
      }
      // TextInput handles the typing
      return;
    }

    if (key.escape) {
      onCancel();
      exit();
      return;
    }

    if (input === 'b' && onBack) {
      onBack();
      return;
    }

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < plan.steps.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.return) {
      // Toggle expand/collapse
      setExpandedIndex(expandedIndex === selectedIndex ? null : selectedIndex);
    } else if (input === 'c') {
      // Copy SQL to clipboard (we'll just show it for now since clipboard access is limited)
      const step = plan.steps[selectedIndex];
      // In a real implementation, you'd use a clipboard library
      // For now, we'll just indicate it was "copied"
    } else if (input === 'k' && mode === 'migrate' && !editingKey) {
      setEditingKey(true);
    } else if (input === 'y' && mode === 'migrate' && onExecute && migrationKey) {
      onExecute(migrationKey);
    }
  });

  const isReadOnly = mode === 'compare';

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title bar */}
      <Box marginBottom={1}>
        <Text bold color={DB_COLORS.accent}>
          Plan — {dbName}
        </Text>
      </Box>

      {/* Summary */}
      <Box marginBottom={1}>
        <Text>
          {plan.stats.totalSteps} steps · {plan.stats.warnings}{' '}
          <Text color={DB_COLORS.yellow}>⚠</Text> · {plan.stats.destructive}{' '}
          <Text color={DB_COLORS.red}>destructive</Text>
        </Text>
      </Box>

      {/* Steps list */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.border}
        paddingX={1}
        paddingY={1}
        minHeight={10}
      >
        {plan.steps.map((step, idx) => {
          const hazard = getHazardGlyph(step.hazardLevel);
          const isSelected = idx === selectedIndex;
          const isExpanded = idx === expandedIndex;

          return (
            <Box key={idx} flexDirection="column" marginBottom={isExpanded ? 1 : 0}>
              <Box>
                <Text inverse={isSelected}>
                  {isSelected ? '▸' : ' '} {idx + 1}{' '}
                </Text>
                <Text color={hazard.color} inverse={isSelected}>
                  {hazard.glyph} {hazard.label}{' '}
                </Text>
                <Text inverse={isSelected}>
                  {step.description.substring(0, 60)}
                  {step.description.length > 60 ? '...' : ''}
                </Text>
              </Box>

              {isExpanded && (
                <Box
                  flexDirection="column"
                  marginLeft={4}
                  marginTop={1}
                  paddingLeft={1}
                  borderLeft
                  borderStyle="single"
                  borderColor={DB_COLORS.accent}
                >
                  <Box flexDirection="column" marginBottom={1}>
                    {step.sql.split('\n').map((line, lineIdx) => (
                      <Text key={lineIdx} dimColor>
                        {line}
                      </Text>
                    ))}
                  </Box>
                  {step.hazardLevel !== 'none' && (
                    <Text color={hazard.color}>
                      {hazard.glyph} {step.hazardLevel.toUpperCase()} — review this carefully
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Migration key input (migrate mode only) */}
      {mode === 'migrate' && (
        <Box marginTop={1} marginBottom={1}>
          <Text>Migration key  </Text>
          {editingKey ? (
            <TextInput
              value={migrationKey}
              onChange={setMigrationKey}
              onSubmit={() => setEditingKey(false)}
            />
          ) : (
            <>
              <Text color={DB_COLORS.accent}>[{migrationKey || '(empty)'}]</Text>
              <Text dimColor> (press k to edit)</Text>
            </>
          )}
        </Box>
      )}

      {/* Action buttons */}
      <Box marginTop={1}>
        {onBack && (
          <Text>
            <Text dimColor>[</Text>
            <Text>← Back</Text>
            <Text dimColor>]</Text> {' '}
          </Text>
        )}
        {mode === 'migrate' && onExecute && migrationKey && (
          <Text>
            <Text dimColor>[</Text>
            <Text color={DB_COLORS.green}>y Execute</Text>
            <Text dimColor>]</Text>
          </Text>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderTop paddingTop={1}>
        <Text dimColor>
          {isReadOnly
            ? '↑↓ select · ↵ expand · c copy SQL · Esc cancel'
            : '↑↓ select · ↵ expand · k edit key · y execute · b back · Esc cancel'}
        </Text>
      </Box>
    </Box>
  );
};
