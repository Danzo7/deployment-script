// ─── Remote Restart Command ───────────────────────────────────────────────────
//
// Restarts the SSH remote server (stop + start).
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { remoteStop } from './remote-stop.js';
import { remoteStart } from './remote-start.js';
import { REMOTE_PORT } from '../constants.js';

export async function remoteRestart(
  port: number = REMOTE_PORT,
  daemon = false
): Promise<void> {
  Logger.info(chalk.cyan('Restarting remote server...'));
  Logger.nl();

  // Stop first (graceful)
  await remoteStop(false);

  // Wait a moment
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Start again
  await remoteStart(port, daemon);
}
