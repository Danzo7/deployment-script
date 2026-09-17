import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { ControlledTextInput as TextInput } from '../../../components/ControlledTextInput.js';
import { PlanReviewScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';
import { Keybar } from '../../../components/Keybar.js';

// Hazard metadata for cleaner rendering
const HAZARD_META = {
  none: {
    glyph: '✓',
    color: DB_COLORS.green,
  },
  warning: {
    glyph: '⚠',
    color: DB_COLORS.yellow,
  },
  destructive: {
    glyph: '✗',
    color: DB_COLORS.red,
  },
} as const;

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
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Calculate viewport for scrolling
  const maxVisibleSteps = 15; // Adjust based on typical terminal height
  const scrollOffset = useMemo(() => {
    // Keep selected item in the middle third of the viewport when possible
    const offset = Math.max(0, selectedIndex - Math.floor(maxVisibleSteps / 2));
    return Math.min(offset, Math.max(0, plan.steps.length - maxVisibleSteps));
  }, [selectedIndex, plan.steps.length]);

  const visibleSteps = plan.steps.slice(scrollOffset, scrollOffset + maxVisibleSteps);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + maxVisibleSteps < plan.steps.length;

  useInput((input, key) => {
    if (showConfirmation) {
      if (key.escape) {
        setShowConfirmation(false);
      } else if (key.return && migrationKey) {
        onExecute?.(migrationKey);
      }
      return;
    }

    if (editingKey) {
      if (key.escape) {
        setEditingKey(false);
      }
      // TextInput handles the typing
      return;
    }

    if (key.escape) {
      onCancel();
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
    } else if (input === 'k' && mode === 'migrate' && !editingKey) {
      setEditingKey(true);
    } else if (input === 'y' && mode === 'migrate' && onExecute && migrationKey) {
      setShowConfirmation(true);
    }
  });

  const isReadOnly = mode === 'compare';

  // Handle empty plan
  if (plan.steps.length === 0) {
    return (
      <Box flexDirection="column" height="100%" paddingX={2}>
        <Box>
          <Text bold color={DB_COLORS.accent}>
            Plan — {dbName}
          </Text>
        </Box>
        <Box marginTop={2}>
          <Text color={DB_COLORS.green}>✓ No schema changes detected.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Current schema matches the desired schema.</Text>
        </Box>
        <Box marginTop={2}>
          <Text>
            <Text dimColor>[</Text>
            <Text>Esc</Text>
            <Text dimColor>]</Text> back
          </Text>
        </Box>
      </Box>
    );
  }

  // Confirmation screen
  if (showConfirmation) {
    const hasDestructive = plan.stats.destructive > 0;
    return (
      <Box flexDirection="column" height="100%" paddingX={2} justifyContent="center">
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={hasDestructive ? DB_COLORS.red : DB_COLORS.border}
          paddingX={2}
          paddingY={1}
        >
          <Text bold color={DB_COLORS.accent}>
            Execute migration?
          </Text>
          <Box marginTop={1} />
          <Box>
            <Text dimColor>Database:    </Text>
            <Text>{dbName}</Text>
          </Box>
          <Box>
            <Text dimColor>Steps:       </Text>
            <Text>{plan.stats.totalSteps}</Text>
          </Box>
          <Box>
            <Text dimColor>Warnings:    </Text>
            <Text color={DB_COLORS.yellow}>{plan.stats.warnings}</Text>
          </Box>
          <Box>
            <Text dimColor>Destructive: </Text>
            <Text color={DB_COLORS.red}>{plan.stats.destructive}</Text>
          </Box>

          {hasDestructive && (
            <>
              <Box marginTop={1} />
              <Text color={DB_COLORS.red}>⚠ This migration contains destructive operations</Text>
            </>
          )}

          <Box marginTop={1} />
          <Box>
            <Text>Press </Text>
            <Text color={DB_COLORS.green}>Enter</Text>
            <Text> to confirm, </Text>
            <Text>Esc</Text>
            <Text> to cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%" paddingX={2}>
      {/* Title bar */}
      <Box>
        <Text bold color={DB_COLORS.accent}>
          Plan — {dbName}
        </Text>
      </Box>

      {/* Summary */}
      <Box>
        <Text>
          {plan.stats.totalSteps} steps   {plan.stats.warnings}{' '}
          <Text color={DB_COLORS.yellow}>warnings</Text>   {plan.stats.destructive}{' '}
          <Text color={DB_COLORS.red}>destructive</Text>
        </Text>
      </Box>

      {/* Steps list with scroll indicators */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.border}
        paddingX={1}
        paddingY={1}
        flexGrow={1}
      >
        {hasMoreAbove && (
          <Box justifyContent="center">
            <Text dimColor>↑ more</Text>
          </Box>
        )}

        {visibleSteps.map((step, visIdx) => {
          const idx = visIdx + scrollOffset;
          const hazard = HAZARD_META[step.hazardLevel];
          const isSelected = idx === selectedIndex;
          const isExpanded = idx === expandedIndex;

          return (
            <Box key={idx} flexDirection="column" marginBottom={isExpanded ? 1 : 0}>
              <Box>
                <Text inverse={isSelected}>{isSelected ? '▸' : ' '}</Text>
                <Text color={hazard.color} inverse={isSelected}>
                  {hazard.glyph}
                </Text>
                <Text inverse={isSelected}>  {idx + 1}  </Text>
                <Text inverse={isSelected}>{step.description}</Text>
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
                  {/* SQL Section */}
                  <Box flexDirection="column" marginBottom={1}>
                    <Text dimColor>├─ SQL</Text>
                    {step.sql.split('\n').map((line, lineIdx) => (
                      <Text key={lineIdx} dimColor>
                        │  {line}
                      </Text>
                    ))}
                    <Text dimColor>│</Text>
                  </Box>

                  {/* Hazards Section */}
                  {step.hazards && step.hazards.length > 0 && (
                    <Box flexDirection="column" marginBottom={1}>
                      <Text dimColor>├─ Hazards</Text>
                      {step.hazards.map((h, hIdx) => (
                        <Box key={hIdx}>
                          <Text dimColor>│  </Text>
                          <Text color={hazard.color}>{hazard.glyph} </Text>
                          <Text>{h.message}</Text>
                        </Box>
                      ))}
                      <Text dimColor>│</Text>
                    </Box>
                  )}

                  {/* Metadata Section */}
                  <Box flexDirection="column">
                    {step.lockTimeoutMs !== undefined && (
                      <Box>
                        <Text dimColor>├─ Lock timeout: </Text>
                        <Text>{(step.lockTimeoutMs / 1000).toFixed(1)}s</Text>
                      </Box>
                    )}
                    <Box>
                      <Text dimColor>└─ Transactional: </Text>
                      <Text>{step.transactional ? 'yes' : 'no'}</Text>
                    </Box>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}

        {hasMoreBelow && (
          <Box justifyContent="center">
            <Text dimColor>↓ more</Text>
          </Box>
        )}
      </Box>

      {/* Migration key input (migrate mode only) */}
      {mode === 'migrate' && (
        <Box>
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
      <Box>
        {onBack && (
          <Text>
            <Text dimColor>[</Text>
            <Text>b back</Text>
            <Text dimColor>]</Text>{' '}
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
      <Keybar
        hints={
          isReadOnly
            ? [
                { label: '↑↓', desc: 'select' },
                { label: '↵', desc: 'expand' },
                { label: 'Esc', desc: 'cancel' },
              ]
            : [
                { label: '↑↓', desc: 'select' },
                { label: '↵', desc: 'expand' },
                { label: 'k', desc: 'edit key' },
                { label: 'y', desc: 'execute' },
                ...(onBack ? [{ label: 'b', desc: 'back' }] : []),
                { label: 'Esc', desc: 'cancel' },
              ]
        }
      />
    </Box>
  );
};
