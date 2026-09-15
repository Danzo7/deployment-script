import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ControlledTextInput as TextInput } from '../../../components/ControlledTextInput.js';
import { ManualReviewScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';

const DESTRUCTIVE_KEYWORDS = [
  'DROP',
  'TRUNCATE',
  'DELETE',
  'UPDATE',
];

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
  const { exit } = useApp();

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

    if (input === 'b') {
      onBack();
      return;
    }

    if (input === 'k') {
      setEditingKey(true);
    } else if (input === 'y' && migrationKey) {
      onExecute(migrationKey);
    }
  });

  const sqlLines = sql.split('\n');

  return (
    <Box flexDirection="column" height="100%" paddingX={2} paddingY={1}>
      {/* Title bar */}
      <Box marginBottom={1}>
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
        marginBottom={1}
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

      {/* SQL display with warnings */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.border}
        paddingX={1}
        paddingY={1}
        marginBottom={1}
        flexGrow={1}
      >
        {sqlLines.map((line, idx) => {
          const hasWarning = hasDestructiveKeyword(line);
          return (
            <Box key={idx}>
              {hasWarning && <Text color={DB_COLORS.yellow}>⚠ </Text>}
              {!hasWarning && <Text>{'  '}</Text>}
              <Text dimColor={!hasWarning}>{line}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Migration key input */}
      <Box marginBottom={1}>
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
      <Box marginBottom={1}>
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
      <Box borderStyle="single" borderTop paddingTop={1}>
        <Text dimColor>k edit key · y execute · b back · Esc cancel</Text>
      </Box>
    </Box>
  );
};
