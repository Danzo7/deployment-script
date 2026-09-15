import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { SchemaEditorProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';

export const SchemaEditor: React.FC<SchemaEditorProps> = ({
  dbName,
  initialText,
  mode,
  onSubmit,
  onCancel,
}) => {
  const [lines, setLines] = useState<string[]>(
    initialText ? initialText.split('\n') : ['']
  );
  const [cursorLine, setCursorLine] = useState(0);
  const [modified, setModified] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentLineEdit, setCurrentLineEdit] = useState('');
  const { exit } = useApp();

  const title =
    mode === 'generated'
      ? `Desired schema — ${dbName}`
      : `Migration SQL — ${dbName}`;

  const handleSubmit = () => {
    const text = lines.join('\n');
    onSubmit(text);
  };

  useInput((input, key) => {
    // Global shortcuts (work in both modes)
    if (key.ctrl && input === 's') {
      handleSubmit();
      return;
    }

    if (key.ctrl && input === 'x') {
      onCancel();
      exit();
      return;
    }

    // Edit mode - currently editing a line
    if (editMode) {
      if (key.return) {
        // Save the edited line
        const newLines = [...lines];
        newLines[cursorLine] = currentLineEdit;
        setLines(newLines);
        setModified(true);
        setEditMode(false);
        // Move to next line or create new one
        if (cursorLine < lines.length - 1) {
          setCursorLine(cursorLine + 1);
        } else {
          setLines([...newLines, '']);
          setCursorLine(cursorLine + 1);
        }
      } else if (key.escape) {
        // Cancel edit
        setEditMode(false);
      }
      // TextInput handles the actual typing
      return;
    }

    // Navigation mode
    if (key.upArrow && cursorLine > 0) {
      setCursorLine(cursorLine - 1);
    } else if (key.downArrow && cursorLine < lines.length - 1) {
      setCursorLine(cursorLine + 1);
    } else if (key.return) {
      // Start editing current line
      setEditMode(true);
      setCurrentLineEdit(lines[cursorLine]);
    } else if (input === 'i') {
      // 'i' to insert/edit
      setEditMode(true);
      setCurrentLineEdit(lines[cursorLine]);
    } else if (input === 'o') {
      // 'o' to open new line below
      const newLines = [
        ...lines.slice(0, cursorLine + 1),
        '',
        ...lines.slice(cursorLine + 1),
      ];
      setLines(newLines);
      setCursorLine(cursorLine + 1);
      setEditMode(true);
      setCurrentLineEdit('');
      setModified(true);
    } else if (input === 'O') {
      // 'O' to open new line above
      const newLines = [
        ...lines.slice(0, cursorLine),
        '',
        ...lines.slice(cursorLine),
      ];
      setLines(newLines);
      setEditMode(true);
      setCurrentLineEdit('');
      setModified(true);
    } else if (key.ctrl && input === 'k') {
      // Cut line
      if (lines.length > 1) {
        const newLines = lines.filter((_, i) => i !== cursorLine);
        setLines(newLines);
        setModified(true);
        if (cursorLine >= newLines.length) {
          setCursorLine(newLines.length - 1);
        }
      } else {
        // Last line, just clear it
        setLines(['']);
        setModified(true);
      }
    }
  });

  const maxLineNumWidth = String(lines.length).length;

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
        {lines.map((line, idx) => {
          const lineNum = String(idx + 1).padStart(maxLineNumWidth, ' ');
          const isCurrent = idx === cursorLine;
          const isEditing = isCurrent && editMode;

          return (
            <Box key={idx}>
              <Text dimColor>{lineNum} │ </Text>
              {isEditing ? (
                <TextInput
                  value={currentLineEdit}
                  onChange={setCurrentLineEdit}
                />
              ) : (
                <>
                  <Text color={isCurrent ? DB_COLORS.text : undefined}>
                    {line}
                  </Text>
                  {isCurrent && <Text color={DB_COLORS.accent}>▏</Text>}
                </>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderTop paddingTop={1}>
        <Text dimColor>
          {editMode
            ? '↵ save line · Esc cancel edit'
            : '↑↓ navigate · i/↵ edit · o new line below · O new line above · ^K cut · ^S submit · ^X cancel'}
        </Text>
      </Box>
    </Box>
  );
};
