// ─── Remote Stop Command ──────────────────────────────────────────────────────
//
// Stops a running SSH remote server gracefully.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { PidManager } from '../utils/pid-manager.js';
import { RemoteIpcClient } from '../utils/remote-ipc-client.js';
import {
  REMOTE_PID_FILE_PATH,
  REMOTE_IPC_SOCKET_PATH,
} from '../constants.js';

/**
 * Wait for server to stop (with timeout)
 */
async function waitForStop(
  pidManager: PidManager,
  timeoutMs = 10000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (!pidManager.isProcessRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

/**
 * Stop the remote server
 */
export async function remoteStop(force = false): Promise<void> {
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);

  // Check if server is running
  if (!pidManager.isProcessRunning()) {
    pidManager.cleanStale();
    Logger.warn('Remote server is not running');
    return;
  }

  const pid = pidManager.readPid()!;

  if (force) {
    Logger.info(chalk.yellow('Force stopping remote server...'));
    try {
      process.kill(pid, 'SIGKILL');
      pidManager.removePid();
      Logger.success(chalk.green('✔ Remote server force stopped'));
    } catch (err: any) {
      Logger.error(`Failed to stop server: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  Logger.info(chalk.cyan('Stopping remote server gracefully...'));

  // Try graceful shutdown via IPC first
  try {
    const client = new RemoteIpcClient(REMOTE_IPC_SOCKET_PATH);
    await client.connect();
    await client.shutdown();
    client.disconnect();

    Logger.info('  Waiting for server to drain active sessions...');

    const stopped = await waitForStop(pidManager, 15000);
    if (stopped) {
      Logger.success(chalk.green('✔ Remote server stopped'));
      pidManager.cleanStale();
      return;
    } else {
      Logger.warn('Server did not stop in time, sending SIGTERM...');
    }
  } catch {
    // IPC failed, fall back to SIGTERM
    Logger.info('  Sending SIGTERM signal...');
  }

  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
    
    const stopped = await waitForStop(pidManager, 10000);
    if (stopped) {
      Logger.success(chalk.green('✔ Remote server stopped'));
      pidManager.cleanStale();
    } else {
      Logger.warn(
        `Server did not stop gracefully. Use ${chalk.cyan('dm remote stop --force')} to force kill.`
      );
      process.exit(1);
    }
  } catch (err: any) {
    Logger.error(`Failed to stop server: ${err.message}`);
    process.exit(1);
  }
}
