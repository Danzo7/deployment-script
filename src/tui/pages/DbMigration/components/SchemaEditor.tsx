import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextArea, LineNumberPrefix } from 'react-ink-textarea';
import { SchemaEditorProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';

export const SchemaEditor: React.FC<SchemaEditorProps> = ({
  dbName,
  initialText,
  mode,
  onSubmit,
  onCancel,
  onBack,
}) => {
  const [value, setValue] = useState(initialText || '');
  const [modified, setModified] = useState(false);

  const title =
    mode === 'generated'
      ? `Desired schema — ${dbName}`
      : `Migration SQL — ${dbName}`;

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setModified(newValue !== (initialText || ''));
  };

  useInput((input, key) => {
    // Save shortcut
    if (key.ctrl && input === 's') {
      onSubmit(value);
      return;
    }
    // Back shortcut
    if (key.ctrl && input === 'b') {
      if (onBack) {
        onBack();
      }
      return;
    }
    // Cancel shortcut
    if (key.ctrl && input === 'x') {
      onCancel();
      return;
    }
  });

  return (
    <Box flexDirection="column" height="100%" paddingX={2} paddingY={1}>
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
        flexGrow={1}
      >
        <TextArea
          focus
          value={value}
          onChange={handleChange}
          onSubmit={() => {}} 
          highlightActiveLine
          activeLineColor={DB_COLORS.accentDim}
          linePrefix={LineNumberPrefix}
          tabWidth={2}
          keybindings={{
            Enter: false, // Disable Enter key submit - use Ctrl+S instead
          }}
        />
      </Box>

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderTop paddingTop={1}>
        <Text dimColor>
          ^S save{onBack ? ' · ^B back' : ''} · ^X cancel · ^Enter newline · ^Z undo · ^Y redo
        </Text>
      </Box>
    </Box>
  );
};
