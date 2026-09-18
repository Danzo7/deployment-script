/**
 * Remote command access control.
 * 
 * Centralizes the logic for blocking commands in remote sessions.
 * Used by both the interactive REPL dispatcher and SSH exec handler.
 */

import { COMMANDS } from '../command-registry.js';

/**
 * Checks if a command should be blocked in remote sessions.
 * 
 * Commands are blocked if:
 * 1. They are marked `cliOnly: true` in the registry (must run locally)
 * 
 * @param cmdKey - Top-level command name (e.g., 'deploy', 'delete', 'remote')
 * @returns true if the command should be blocked, false if allowed
 */
export function isCommandBlockedForRemote(cmdKey: string): boolean {
  const node = COMMANDS[cmdKey];
  if (!node) return false;
  
  // Check if command is marked as CLI-only (not allowed in remote sessions)
  return node.cliOnly === true;
}

/**
 * Gets a human-readable reason for why a command is blocked.
 * 
 * @param cmdKey - Top-level command name
 * @returns Error message explaining why the command is blocked
 */
export function getBlockedCommandMessage(cmdKey: string): string {
  const node = COMMANDS[cmdKey];
  
  if (node?.cliOnly) {
    return `Command "${cmdKey}" is only available via the CLI (\`dm ${cmdKey}\`) when run directly on the server, not through remote sessions.`;
  }
  
  return `Command "${cmdKey}" is not allowed in remote sessions.`;
}
