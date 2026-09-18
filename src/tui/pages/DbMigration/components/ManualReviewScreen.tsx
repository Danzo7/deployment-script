import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ControlledTextInput as TextInput } from '../../../components/ControlledTextInput.js';
import { ManualReviewScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';
import { Keybar } from '../../../components/Keybar.js';

const hasDestructiveKeyword = (sql: string): boolean => {
  const upperSql = sql.toUpperCase();
  
  // Check for DROP or TRUNCATE
  if (upperSql.includes('DROP') || upperSql.includes('TRUNCATE')) {
    return true;
  }
  
  // Check for DELETE or UPDATE without WHERE
  if (upperSql.includes('DELETE') && !upperSql.includes('WHERE')) {
    return true;
  }
  if (upperSql.includes('UPDATE') && !upperSql.includes('WHERE')) {
    return true;
  }
  
  return false;
};

export const ManualReviewScreen: React.FC<ManualReviewScreenProps> = ({
  dbName,
  sql,
  migrationKey: initialKey,
  onExecute,
  onBack,
  onCancel,
}) => {
  const [migrationKey, setMigrationKey] = useState(initialKey || '');
  const [editingKey, setEditingKey] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);

  const sqlLines = sql.split('\n');
  const maxVisibleLines = 20; // Adjust based on typical terminal height
  const visibleLines = sqlLines.slice(scrollOffset, scrollOffset + maxVisibleLines);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + maxVisibleLines < sqlLines.length;

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
      return;
    }

    if (input === 'b') {
      onBack();
      return;
    }

    // Scroll up/down
    if (key.upArrow && scrollOffset > 0) {
      setScrollOffset(scrollOffset - 1);
      return;
    }

    if (key.downArrow && scrollOffset < sqlLines.length - maxVisibleLines) {
      setScrollOffset(scrollOffset + 1);
      return;
    }

    // Page up/down
    if (key.pageUp) {
      setScrollOffset(Math.max(0, scrollOffset - maxVisibleLines));
      return;
    }

    if (key.pageDown) {
      setScrollOffset(Math.min(sqlLines.length - maxVisibleLines, scrollOffset + maxVisibleLines));
      return;
    }

    if (input === 'k') {
      setEditingKey(true);
    } else if (input === 'y' && migrationKey) {
      onExecute(migrationKey);
    }
  });

  return (
    <Box flexDirection="column" height="100%" paddingX={2}>
      {/* Title bar */}
      <Box flexShrink={0}>
        <Text bold color={DB_COLORS.accent}>
          Review — {dbName} — manual migration
        </Text>
      </Box>

      {/* Warning banner */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.yellow}
        paddingX={1}
        paddingY={1}
      >
        <Text color={DB_COLORS.yellow}>
          ⚠ Raw SQL executes as-is. No schema diff
        </Text>
        <Text color={DB_COLORS.yellow}>
          {'  '}or hazard analysis is performed for
        </Text>
        <Text color={DB_COLORS.yellow}>
          {'  '}manual migrations.
        </Text>
      </Box>

      {/* SQL display with warnings and virtualization */}
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
            <Text dimColor>↑ {scrollOffset} more lines above</Text>
          </Box>
        )}

        {visibleLines.map((line, visIdx) => {
          const idx = visIdx + scrollOffset;
          const hasWarning = hasDestructiveKeyword(line);
          return (
            <Box key={idx}>
              <Text dimColor>{String(idx + 1).padStart(4, ' ')}  </Text>
              {hasWarning && <Text color={DB_COLORS.yellow}>⚠ </Text>}
              {!hasWarning && <Text>{'  '}</Text>}
              <Text dimColor={!hasWarning}>{line}</Text>
            </Box>
          );
        })}

        {hasMoreBelow && (
          <Box justifyContent="center">
            <Text dimColor>↓ {sqlLines.length - (scrollOffset + maxVisibleLines)} more lines below</Text>
          </Box>
        )}
      </Box>

      {/* Migration key input */}
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

      {/* Action buttons */}
      <Box>
        <Text>
          <Text dimColor>[</Text>
          <Text>b back</Text>
          <Text dimColor>]</Text>
        </Text>
        <Text>  </Text>
        {migrationKey && (
          <Text>
            <Text dimColor>[</Text>
            <Text color={DB_COLORS.green}>y Execute</Text>
            <Text dimColor>]</Text>
          </Text>
        )}
      </Box>

      {/* Footer */}
      <Keybar
        hints={[
          { label: '↑↓', desc: 'scroll' },
          { label: 'PgUp/PgDn', desc: 'page' },
          { label: 'k', desc: 'edit key' },
          { label: 'y', desc: 'execute' },
          { label: 'b', desc: 'back' },
          { label: 'Esc', desc: 'cancel' },
        ]}
      />
    </Box>
  );
};
