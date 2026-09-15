import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { TextArea, LineNumberPrefix } from 'react-ink-textarea';
import { SchemaEditorProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';

export const SchemaEditor: React.FC<SchemaEditorProps> = ({
  dbName,
  initialText,
  mode,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(initialText || '');
  const [modified, setModified] = useState(false);
  const { exit } = useApp();

  const title =
    mode === 'generated'
      ? `Desired schema — ${dbName}`
      : `Migration SQL — ${dbName}`;

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setModified(newValue !== (initialText || ''));
  };

  const handleSubmit = (submittedValue: string) => {
    onSubmit(submittedValue);
  };

  useInput((input, key) => {
    // Cancel shortcut
    if (key.ctrl && input === 'x') {
      onCancel();
      exit();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title bar */}
      <Box marginBottom={1}>
        <Text bold color={DB_COLORS.accent}>
          {title}
        </Text>
        {modified && (
          <Text color={DB_COLORS.yellow}> [unsaved]</Text>
        )}
      </Box>

      {/* Editor area with line numbers */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.border}
        paddingX={1}
        paddingY={1}
        minHeight={15}
      >
        <TextArea
          focus
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          highlightActiveLine
          activeLineColor={DB_COLORS.accentDim}
          linePrefix={LineNumberPrefix}
          viewportLines={13}
          tabWidth={2}
          initialLineCount={13}
        />
      </Box>

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderTop paddingTop={1}>
        <Text dimColor>
          ^S submit · ^X cancel · ^Z undo · ^Y redo
        </Text>
      </Box>
    </Box>
  );
};
