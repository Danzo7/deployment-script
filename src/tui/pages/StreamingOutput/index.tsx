import React, { useEffect, useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';
import { usePageParams } from '../../../app/navigation/use-navigation.js';
import { PageId } from '../../../app/navigation/types.js';
import { StaticOutputList, type OutputEntry } from '../../../app/output/static-output-list.js';

let entryIdCounter = 0;

export function StreamingOutputPage() {
  const { title, run } = usePageParams<PageId.StreamingOutput>();
  const exit = usePageExit();
  const [entries, setEntries] = useState<OutputEntry[]>([]);

  const emit = useCallback((line: string) => {
    setEntries((prev) => [...prev, { id: String(entryIdCounter++), text: line.trimEnd() }]);
  }, []);

  useEffect(() => {
    // Shadow process.exit to call page exit instead
    const originalExit = process.exit.bind(process);
    (process as any).exit = () => exit();

    const stop = run.start(emit);

    return () => {
      (process as any).exit = originalExit;
      stop();
    };
  }, [run, emit, exit]);

  return (
    <Box flexDirection="column">
      <StaticOutputList entries={entries} />
      <Text dimColor>Press Esc to stop tailing "{title}".</Text>
    </Box>
  );
}
