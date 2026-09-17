import React from 'react';
import { Text } from 'ink';
import { Static } from 'ink';

export interface OutputEntry {
  id: string;
  text: string;
}

interface StaticOutputListProps {
  entries: OutputEntry[];
  staticKey?: number;
}

export function StaticOutputList({ entries, staticKey = 0 }: StaticOutputListProps) {
  return (
    <Static key={staticKey} items={entries}>
      {(entry) => <Text key={entry.id}>{entry.text}</Text>}
    </Static>
  );
}
