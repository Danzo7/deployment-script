import React from 'react';
import { render } from 'ink';
import { Logger } from '../../utils/logger.js';
import { pauseRepl, resumeRepl, getActiveRl } from '../../utils/repl-context.js';

/**
 * Launch a TUI component in alternate screen mode with proper setup/cleanup.
 * Automatically pauses the REPL if one is active, and resumes it after the TUI exits.
 */
export async function launchTui<T = void>(
  component: React.ReactElement,
  options?: {
    muteLogger?: boolean;
    onExit?: () => void | Promise<void>;
  }
): Promise<T> {
  const shouldMuteLogger = options?.muteLogger ?? true;
  const wasMuted = Logger.isMuted;
  const hadActiveRepl = !!getActiveRl();

  if (shouldMuteLogger) {
    Logger.isMuted = true;
  }

  if (hadActiveRepl) {
    pauseRepl();
  }

  process.stdout.write('\x1b[?1049h');
  process.stdout.write('\x1b[H');

  const { waitUntilExit } = render(component, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });

  try {
    await waitUntilExit();
  } finally {
    // Restore the terminal + REPL the instant Ink itself is done —
    // BEFORE running any caller-supplied onExit side effect. onExit may
    // block indefinitely (a log tail, a nested TUI); that must never be
    // able to starve the shell of its stdin listener.
    process.stdout.write('\x1b[?1049l');
    
    // Take stdin back deterministically — don't rely on Ink's internal
    // unmount cleanup having already run by the time we get here.
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();

    Logger.isMuted = wasMuted;
    if (hadActiveRepl) await resumeRepl();
  }

  if (options?.onExit) {
    await options.onExit();
  }

  return undefined as T;
}
