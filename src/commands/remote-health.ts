// ─── Remote Health Command ────────────────────────────────────────────────────
//
// Health check for the remote server. Returns exit code 0 if healthy, 1 if not.
// Useful for monitoring scripts and service managers.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { PidManager } from '../utils/pid-manager.js';
import { RemoteIpcClient } from '../utils/remote-ipc-client.js';
import {
  REMOTE_PID_FILE_PATH,
  REMOTE_IPC_SOCKET_PATH,
} from '../constants.js';

export async function remoteHealth(quiet = false): Promise<void> {
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);

  // Check PID file
  if (!pidManager.isProcessRunning()) {
    pidManager.cleanStale();
    if (!quiet) {
      Logger.error('Remote server is not running');
    }
    process.exit(1);
  }

  // Check IPC communication
  try {
    const client = new RemoteIpcClient(REMOTE_IPC_SOCKET_PATH);
    await client.connect();
    
    const canPing = await client.ping();
    const status = await client.getStatus();
    
    client.disconnect();

    if (!canPing) {
      if (!quiet) {
        Logger.error('Remote server is not responding');
      }
      process.exit(1);
    }

    if (!quiet) {
      Logger.success(chalk.green('✔ Remote server is healthy'));
      Logger.info(`  Port          : ${status.port}`);
      Logger.info(`  Active sessions: ${status.activeSessions}`);
      Logger.info(`  Uptime        : ${Math.floor(status.uptime / 1000)}s`);
    }

    process.exit(0);
  } catch (err: any) {
    if (!quiet) {
      Logger.error(`Remote server health check failed: ${err.message}`);
    }
    process.exit(1);
  }
}
