// ─── Quick connect shortcuts ─────────────────────────────────────────────────
//
// Handles convenient connect shortcuts before yargs parses commands:
//   - dm @host[:port] [command...]  — Modern @ syntax
//   - dm --host <ip> [--port <p>]   — Traditional flag syntax
//
// Both support interactive shell (no command) or direct command execution.
// ─────────────────────────────────────────────────────────────────────────────

import { Logger } from './logger.js';
import { REMOTE_PORT } from '../constants.js';
import { connectRemote } from './ssh-client.js';

/**
 * Checks if raw CLI args contain a quick connect shortcut and handles it.
 * Returns true if a shortcut was found and handled (caller should exit).
 */
export async function handleQuickConnect(rawArgs: string[]): Promise<boolean> {
  // ── Check for @host[:port] syntax ───────────────────────────────────────────
  const atHostIdx = rawArgs.findIndex((a) => a.startsWith('@'));
  if (atHostIdx !== -1) {
    const atHostArg = rawArgs[atHostIdx];
    const hostPart = atHostArg.slice(1); // Remove @

    if (!hostPart) {
      Logger.error(
        'Invalid @host syntax. Example: dm @10.10.10.10 deploy myapp'
      );
      process.exit(1);
    }

    // Parse host:port if provided
    let host: string;
    let port: number | undefined;
    if (hostPart.includes(':')) {
      const [h, p] = hostPart.split(':');
      host = h;
      port = parseInt(p, 10);
      if (isNaN(port)) {
        Logger.error(`Invalid port in @host:port syntax: ${p}`);
        process.exit(1);
      }
    } else {
      host = hostPart;
    }

    // Check for --identity flag
    const identIdx = rawArgs.findIndex((a) => a === '--identity' || a === '-i');
    const identity = identIdx !== -1 ? rawArgs[identIdx + 1] : undefined;

    // Collect command args (everything after @host that's not --identity/-i and its value)
    const commandArgs: string[] = [];
    for (let i = atHostIdx + 1; i < rawArgs.length; i++) {
      if (rawArgs[i] === '--identity' || rawArgs[i] === '-i') {
        i++; // Skip the flag and its value
        continue;
      }
      commandArgs.push(rawArgs[i]);
    }

    await connectRemote(
      host,
      port,
      identity,
      commandArgs.length > 0 ? commandArgs : undefined
    );
    return true;
  }

  // ── Fallback to --host flag syntax ─────────────────────────────────────────
  const hostIdx = rawArgs.findIndex((a) => a === '--host' || a === '-H');
  if (hostIdx !== -1) {
    const host = rawArgs[hostIdx + 1];
    if (!host || host.startsWith('-')) {
      Logger.error('--host requires a value, e.g. dm --host 10.10.10.10');
      process.exit(1);
    }
    const portIdx = rawArgs.findIndex((a) => a === '--port' || a === '-p');
    const port = portIdx !== -1 ? Number(rawArgs[portIdx + 1]) : REMOTE_PORT;
    const identIdx = rawArgs.findIndex((a) => a === '--identity' || a === '-i');
    const identity = identIdx !== -1 ? rawArgs[identIdx + 1] : undefined;

    // Collect command args (everything after host that's not a known flag)
    const knownFlags = new Set([
      '--host',
      '-H',
      '--port',
      '-p',
      '--identity',
      '-i',
    ]);
    const commandArgs: string[] = [];
    let skipNext = false;
    for (let i = 0; i < rawArgs.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (knownFlags.has(rawArgs[i])) {
        skipNext = true; // Skip flag value
        continue;
      }
      // Don't collect the flag values themselves
      if (i > 0 && knownFlags.has(rawArgs[i - 1])) {
        continue;
      }
      // Don't collect flags that are not in knownFlags
      if (rawArgs[i].startsWith('-')) {
        continue;
      }
      commandArgs.push(rawArgs[i]);
    }

    await connectRemote(
      host,
      port,
      identity,
      commandArgs.length > 0 ? commandArgs : undefined
    );
    return true;
  }

  return false;
}
