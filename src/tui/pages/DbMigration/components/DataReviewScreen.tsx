import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ControlledTextInput as TextInput } from '../../../components/ControlledTextInput.js';
import { DataReviewScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';
import { Keybar } from '../../../components/Keybar.js';
import { VirtualizedList } from '../../../components/VirtualizedList.js';

export const DataReviewScreen: React.FC<DataReviewScreenProps> = ({
  dbName,
  sql,
  migrationKey: initialKey,
  onExecute,
  onBack,
  onCancel,
}) => {
  const [migrationKey, setMigrationKey] = useState(initialKey || '');
  const [editingKey, setEditingKey] = useState(false);

  const sqlLines = sql.split('\n');

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
          Review — {dbName} — data migration
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
          ⚠ Data-only migration: INSERT, UPDATE, DELETE
        </Text>
        <Text color={DB_COLORS.yellow}>
          {'  '}Schema operations (CREATE/DROP/ALTER) are
        </Text>
        <Text color={DB_COLORS.yellow}>
          {'  '}blocked. Review data changes carefully.
        </Text>
      </Box>

      {/* SQL display with virtualization */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.border}
        paddingX={1}
        paddingY={1}
        flexGrow={1}
      >
        <VirtualizedList
          items={sqlLines}
          maxVisible={20}
          renderItem={(line, idx) => (
            <Box>
              <Text dimColor>{String(idx + 1).padStart(4, ' ')}  </Text>
              <Text>{line}</Text>
            </Box>
          )}
          renderMoreAbove={(count) => (
            <Box justifyContent="center">
              <Text dimColor>↑ {count} more lines above</Text>
            </Box>
          )}
          renderMoreBelow={(count) => (
            <Box justifyContent="center">
              <Text dimColor>↓ {count} more lines below</Text>
            </Box>
          )}
        />
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
