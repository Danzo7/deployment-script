import { useState, useCallback } from 'react';

export function useCursor(initialValue = 0) {
  const [cursor, setCursor] = useState(initialValue);

  const clamp = useCallback((idx: number, len: number) => {
    if (len === 0) return 0;
    return Math.max(0, Math.min(idx, len - 1));
  }, []);

  const moveCursor = useCallback(
    (delta: number, maxLength: number) => {
      setCursor((c) => clamp(c + delta, maxLength));
    },
    [clamp]
  );

  const resetCursor = useCallback(() => setCursor(0), []);

  return { cursor, setCursor, moveCursor, resetCursor, clamp };
}
