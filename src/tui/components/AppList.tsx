import React from 'react';
import { Box, Text } from 'ink';
import type { AppSummary } from '../../utils/dashboard-data.js';
import {
  LIST_W,
  TERM_H,
  statusColor,
  statusDot,
  fmtMem,
  truncate,
} from './shared.js';

interface AppRowProps {
  data: AppSummary;
  selected: boolean;
}

function AppRow({ data, selected }: AppRowProps): React.ReactElement {
  const { app, pm2, restartDelta } = data;
  const status = pm2?.status ?? 'not-found';
  const color = statusColor(status);
  const nameMaxLen =
    LIST_W - (selected ? 2 : 0) - 1 - 2 - (restartDelta >= 3 ? 2 : 0);
  const displayName = truncate(app.name, Math.max(nameMaxLen, 4));

  return (
    <Box flexDirection="column" width={LIST_W}>
      <Box flexDirection="row" width={LIST_W}>
        {selected && (
          <Text bold color="yellow">
            ▌▌
          </Text>
        )}
        <Text color={color}>{statusDot(status)}</Text>
        <Box marginLeft={1}>
          {selected ? (
            <Text bold color="yellow">
              {displayName}
            </Text>
          ) : (
            <Text>{displayName}</Text>
          )}
        </Box>
        {restartDelta >= 3 && <Text color="yellow"> ⚠</Text>}
      </Box>
      <Box flexDirection="row" width={LIST_W} marginLeft={selected ? 3 : 1}>
        {restartDelta >= 3 ? (
          <Text color="red">restart loop</Text>
        ) : (
          <Text dimColor>
            {pm2 ? `${pm2.cpu.toFixed(1)}%  ${fmtMem(pm2.memBytes)}` : '—'}
          </Text>
        )}
      </Box>
    </Box>
  );
}

interface AppListProps {
  summaries: AppSummary[];
  cursor: number;
}

export function AppList({
  summaries,
  cursor,
}: AppListProps): React.ReactElement {
  const availableLines = Math.max(TERM_H - 8, 4);
  const visibleCount = Math.floor(availableLines / 2);

  let viewOffset = 0;
  if (cursor >= visibleCount) viewOffset = cursor - visibleCount + 1;
  viewOffset = Math.min(
    viewOffset,
    Math.max(0, summaries.length - visibleCount)
  );

  const visible = summaries.slice(viewOffset, viewOffset + visibleCount);

  let online = 0,
    errored = 0,
    stopped = 0;
  for (const s of summaries) {
    const st = s.pm2?.status ?? 'not-found';
    if (st === 'online') online++;
    else if (st === 'errored' || st === 'error') errored++;
    else stopped++;
  }

  return (
    <Box flexDirection="column" width={LIST_W}>
      {visible.map((s, i) => (
        <AppRow
          key={s.app.name}
          data={s}
          selected={viewOffset + i === cursor}
        />
      ))}
      {visible.length < visibleCount && (
        <Box flexDirection="column">
          {Array.from({ length: visibleCount - visible.length }).map((_, i) => (
            <Box key={i} height={2} />
          ))}
        </Box>
      )}
      <Box flexDirection="row" gap={1} width={LIST_W}>
        <Text color="green">{online} online</Text>
        <Text color="red">{errored} err</Text>
        <Text dimColor>{stopped} stopped</Text>
      </Box>
    </Box>
  );
}
