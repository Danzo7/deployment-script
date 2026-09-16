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

  // Pause REPL if one is active to avoid stdin/stdout conflicts with Ink
  if (hadActiveRepl) {
    await pauseRepl();
  }

  // Small delay to ensure readline cleanup is complete
  await new Promise<void>((resolve) => setImmediate(resolve));

  // Ensure stdin is in flowing mode for Ink
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }

  try {
    return await new Promise((resolve, reject) => {
      process.stdout.write('\x1b[?1049h'); // enter alternate screen
      process.stdout.write('\x1b[H'); // move cursor to home

      // Explicitly pass stdin/stdout/stderr to Ink
      const { waitUntilExit } = render(component, {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      });

      waitUntilExit()
        .then(async () => {
          process.stdout.write('\x1b[?1049l'); // leave alternate screen
          Logger.isMuted = wasMuted;

          if (options?.onExit) {
            await options.onExit();
          }

          resolve(undefined as T);
        })
        .catch((err) => {
          process.stdout.write('\x1b[?1049l'); // leave alternate screen
          Logger.isMuted = wasMuted;
          reject(err);
        });
    });
  } finally {
    // Always resume REPL if we paused it, even on error or early exit
    if (hadActiveRepl) {
      await resumeRepl();
    }
  }
}
