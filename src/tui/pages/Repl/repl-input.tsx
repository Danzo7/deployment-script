import React, { useState, useCallback } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';
import { CommandHistory } from './history.js';
import { TOP_LEVEL_COMMANDS } from './dispatcher.js';

interface ReplInputProps {
  history: CommandHistory;
  onSubmit: (line: string) => void;
}

export function ReplInput({ history, onSubmit }: ReplInputProps) {
  const [buffer, setBuffer] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      const line = buffer.trim();
      if (line) {
        history.add(line);
        onSubmit(line);
      } else {
        onSubmit('');
      }
      setBuffer('');
      setCursorPos(0);
      history.reset();
      return;
    }

    if (key.upArrow) {
      const prev = history.previous(buffer);
      if (prev !== null) {
        setBuffer(prev);
        setCursorPos(prev.length);
      }
      return;
    }

    if (key.downArrow) {
      const next = history.next();
      if (next !== null) {
        setBuffer(next);
        setCursorPos(next.length);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPos((pos) => Math.max(0, pos - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPos((pos) => Math.min(buffer.length, pos + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newBuffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
        setBuffer(newBuffer);
        setCursorPos(cursorPos - 1);
      }
      return;
    }

    if (key.tab) {
      // Simple tab completion for top-level commands
      const hits = TOP_LEVEL_COMMANDS.filter((c) => c.startsWith(buffer));
      if (hits.length === 1) {
        setBuffer(hits[0] + ' ');
        setCursorPos(hits[0].length + 1);
      }
      return;
    }

    // Regular character input
    if (!key.ctrl && !key.meta && input.length === 1) {
      const newBuffer = buffer.slice(0, cursorPos) + input + buffer.slice(cursorPos);
      setBuffer(newBuffer);
      setCursorPos(cursorPos + 1);
    }
  });

  const displayBuffer = buffer.slice(0, cursorPos) + '█' + buffer.slice(cursorPos);
  
  return (
    <Text>
      {chalk.cyan('dm>')} {displayBuffer}
    </Text>
  );
}
