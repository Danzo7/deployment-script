import React from 'react';
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';
import type { DashboardAction } from '../Dashboard.js';

const PALETTE_VERBS = [
  'restart',
  'stop',
  'deploy',
  'logs',
  'env',
  'rollback',
] as const;
type PaletteVerb = (typeof PALETTE_VERBS)[number];

export function parsePaletteInput(
  input: string,
  appNames: string[]
): DashboardAction | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return null;
  const verb = trimmed.slice(0, spaceIdx).toLowerCase();
  const appName = trimmed.slice(spaceIdx + 1).trim();
  if (!appName || !(PALETTE_VERBS as readonly string[]).includes(verb))
    return null;
  const matched = appNames.find(
    (n) => n.toLowerCase() === appName.toLowerCase()
  );
  if (!matched) return null;
  return { type: verb as PaletteVerb, appName: matched };
}

export function getPaletteSuggestions(
  input: string,
  appNames: string[]
): string[] {
  const query = input.toLowerCase().trim();
  const all: string[] = [];
  for (const verb of PALETTE_VERBS)
    for (const name of appNames) all.push(`${verb} ${name}`);
  if (!query) return all.slice(0, 5);
  const sw = all.filter((s) => s.toLowerCase().startsWith(query));
  if (sw.length >= 5) return sw.slice(0, 5);
  const contains = all.filter(
    (s) => s.toLowerCase().includes(query) && !s.toLowerCase().startsWith(query)
  );
  return [...sw, ...contains].slice(0, 5);
}

interface CommandPaletteProps {
  input: string;
  appNames: string[];
}

export function CommandPalette({
  input,
  appNames,
}: CommandPaletteProps): React.ReactElement {
  const paletteWidth = Math.min(60, TERM_W - 4);
  const suggestions = getPaletteSuggestions(input, appNames);

  return (
    <Box
      flexDirection="column"
      alignSelf="center"
      width={paletteWidth}
      borderStyle="round"
      borderColor="yellow"
    >
      <Box flexDirection="row">
        <Text>: {input}</Text>
        <Text bold color="yellow">
          █
        </Text>
      </Box>
      {suggestions.map((s, i) => (
        <Box key={s} flexDirection="row">
          {i === 0 ? (
            <>
              <Text bold color="yellow">
                ▶{' '}
              </Text>
              <Text bold color="white">
                {s}
              </Text>
            </>
          ) : (
            <>
              <Text dimColor>{'  '}</Text>
              <Text dimColor>{s}</Text>
            </>
          )}
        </Box>
      ))}
      {suggestions.length === 0 && <Text dimColor> no matching commands</Text>}
    </Box>
  );
}
