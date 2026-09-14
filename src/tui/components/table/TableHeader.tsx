import React from 'react';
import { Box, Text } from 'ink';
import { truncate } from '../../utils/formatters.js';

interface TableHeaderProps {
  columns: Array<{ label: string; width: number }>;
}

export function TableHeader({ columns }: TableHeaderProps): React.ReactElement {
  return (
    <Box>
      <Text dimColor>{'│  '}</Text>
      {columns.map((col, i) => (
        <React.Fragment key={i}>
          <Text bold>{truncate(col.label, col.width)}</Text>
          {i < columns.length - 1 && <Text> </Text>}
        </React.Fragment>
      ))}
      <Text dimColor>{'   │'}</Text>
    </Box>
  );
}
