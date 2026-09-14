import { useState, useCallback } from 'react';

export function useLogBuffer(maxLines: number) {
  const [logLines, setLogLines] = useState<string[]>([]);

  const addLog = useCallback(
    (lines: string | string[]) => {
      const newLines = Array.isArray(lines) ? lines : [lines];
      setLogLines((prev) => {
        const next = [...prev, ...newLines];
        return next.length > maxLines ? next.slice(-maxLines) : next;
      });
    },
    [maxLines]
  );

  const clearLogs = useCallback(() => setLogLines([]), []);
  
  const replaceLogs = useCallback((lines: string[]) => setLogLines(lines), []);

  return { logLines, addLog, clearLogs, replaceLogs };
}
