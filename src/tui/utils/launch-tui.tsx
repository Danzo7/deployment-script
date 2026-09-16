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

  // Debug: check if we detect REPL
  console.error(`[DEBUG] hadActiveRepl: ${hadActiveRepl}, isTTY: ${process.stdin.isTTY}, SSH_CONNECTION: ${!!process.env.SSH_CONNECTION}`);

  if (shouldMuteLogger) {
    Logger.isMuted = true;
  }

  // Pause REPL if one is active to avoid stdin/stdout conflicts with Ink
  if (hadActiveRepl) {
    pauseRepl();
  }

  return new Promise((resolve, reject) => {
    process.stdout.write('\x1b[?1049h'); // enter alternate screen
    process.stdout.write('\x1b[H'); // move cursor to home

    const { waitUntilExit } = render(component);

    waitUntilExit()
      .then(async () => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        Logger.isMuted = wasMuted;

        // Debug: check resume path
        console.error(`[DEBUG] Exit: hadActiveRepl=${hadActiveRepl}, will ${hadActiveRepl ? 'call resumeRepl' : 'NOT call resumeRepl'}`);

        // Resume REPL if we paused it
        if (hadActiveRepl) {
          resumeRepl();
        }

        if (options?.onExit) {
          await options.onExit();
        }

        resolve(undefined as T);
      })
      .catch((err) => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        Logger.isMuted = wasMuted;

        // Resume REPL even on error
        if (hadActiveRepl) {
          resumeRepl();
        }

        reject(err);
      });
  });
}
