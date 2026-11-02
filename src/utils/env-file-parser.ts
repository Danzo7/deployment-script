import fs from 'fs';
import path from 'path';

export interface EnvEntry {
  key: string;
  value: string;
}

/**
 * Parses a .env.local file into an ordered array of key/value entries.
 * Comments and blank lines are ignored (not round-tripped).
 */
export function parseEnvFile(envDir: string, fileName: '.env.local' | '.env' = '.env.local'): EnvEntry[] {
  const filePath = path.join(envDir, fileName);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const entries: EnvEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1);
    if (key) entries.push({ key, value });
  }

  return entries;
}

/**
 * Writes the given entries back to .env.local, replacing the file completely.
 */
export function writeEnvFile(envDir: string, entries: EnvEntry[], fileName: '.env.local' | '.env' = '.env.local'): void {
  const filePath = path.join(envDir, fileName);
  const content = entries.map(({ key, value }) => `${key}=${value}`).join('\n');
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}
