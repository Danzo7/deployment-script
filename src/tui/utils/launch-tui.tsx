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
    // Must run the instant Ink itself is done, regardless of whether the
    // caller's onExit (below) ever resolves — this is what keeps a hanging
    // onExit from being able to starve the REPL of its stdin listener.
    process.stdout.write('\x1b[?1049l');
    Logger.isMuted = wasMuted;
    if (hadActiveRepl) await resumeRepl();
  }

  if (options?.onExit) {
    await options.onExit();
  }

  return undefined as T;
}
