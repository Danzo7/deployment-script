// ─── Remote Start Command ─────────────────────────────────────────────────────
//
// Starts the SSH remote server as a standalone process.
// Can run in foreground (with live logs) or daemon mode (background).
// ─────────────────────────────────────────────────────────────────────────────

import { fork, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { PidManager } from '../utils/pid-manager.js';
import { RemoteIpcClient } from '../utils/remote-ipc-client.js';
import {
  REMOTE_PID_FILE_PATH,
  REMOTE_IPC_SOCKET_PATH,
  REMOTE_PORT,
} from '../constants.js';
import { startRemoteServer, serverEvents } from '../utils/ssh-server.js';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

/**
 * Check if server is already running
 */
async function isServerRunning(): Promise<boolean> {
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  
  // Check PID file first
  const pidExists = pidManager.readPid();
  if (!pidExists) {
    // No PID file at all
    return false;
  }

  const isRunning = pidManager.isProcessRunning();
  if (!isRunning) {
    pidManager.cleanStale();
    return false;
  }

  // Process is running - IPC might not be ready yet, try with retries
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = new RemoteIpcClient(REMOTE_IPC_SOCKET_PATH);
      await client.connect();
      const canPing = await client.ping();
      client.disconnect();
      if (canPing) {
        return true;
      }
    } catch {
      // IPC not ready yet, wait and retry
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  // IPC failed but process is running - trust the PID
  return isRunning;
}

/**
 * Start server in foreground mode (with live log streaming)
 */
async function startForeground(port: number): Promise<void> {
  Logger.info(chalk.cyan(`Starting remote server on port ${port}...`));
  Logger.nl();

  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  pidManager.writePid();

  // Cleanup PID on exit
  const cleanup = () => {
    pidManager.removePid();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await startRemoteServer(port);
  } catch (err: any) {
    Logger.error(`Failed to start server: ${err.message}`);
    pidManager.removePid();
    process.exit(1);
  }
}

/**
 * Start server in daemon mode (background)
 */
async function startDaemon(port: number): Promise<void> {
  Logger.info(chalk.cyan(`Starting remote server in daemon mode...`));

  const scriptPath = path.join(ROOT_DIR, 'dist/cli.js');

  // Ensure log directory exists
  const logDir = path.join(path.dirname(REMOTE_PID_FILE_PATH), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }

  const logFile = path.join(logDir, 'dm-remote.log');
  
  // Open log file for appending
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // Use spawn instead of fork for fully detached process
  const child = spawn(
    process.execPath,
    [scriptPath, 'remote', '_start-worker', '--port', String(port)],
    {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: ROOT_DIR,
    }
  );

  // Detach and let it run independently
  child.unref();

  // Close our handles to the log files
  fs.closeSync(out);
  fs.closeSync(err);

  // Wait for the process to initialize and write PID file
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // Verify it started - simplified check
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  const running = pidManager.isProcessRunning();
  
  if (running) {
    Logger.success(chalk.green('✔ Remote server started successfully'));
    Logger.info(`  Port    : ${chalk.bold(String(port))}`);
    Logger.info(`  PID     : ${chalk.bold(String(pidManager.readPid()))}`);
    Logger.info(`  Logs    : ${chalk.cyan(logFile)}`);
    Logger.info(`  Status  : ${chalk.cyan('dm remote status')}`);
    Logger.info(`  Stop    : ${chalk.cyan('dm remote stop')}`);
  } else {
    Logger.error('Failed to start remote server');
    Logger.info(`  Check logs: ${chalk.cyan(logFile)}`);
    Logger.info(`  PID file: ${REMOTE_PID_FILE_PATH}`);
    process.exit(1);
  }
}

/**
 * Worker entry point (called by daemon fork)
 */
export async function remoteStartWorker(port: number): Promise<void> {
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  pidManager.writePid();

  const cleanup = () => {
    pidManager.removePid();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await startRemoteServer(port);
  } catch (err: any) {
    // Log to audit log since stdout is detached
    console.error(`[remote] Failed to start: ${err.message}`);
    pidManager.removePid();
    process.exit(1);
  }
}

/**
 * Main entry point
 */
export async function remoteStart(
  port: number = REMOTE_PORT,
  daemon = false
): Promise<void> {
  // Check if already running
  if (await isServerRunning()) {
    Logger.error('Remote server is already running');
    Logger.info(`  View status: ${chalk.cyan('dm remote status')}`);
    Logger.info(`  Stop server: ${chalk.cyan('dm remote stop')}`);
    process.exit(1);
  }

  if (daemon) {
    await startDaemon(port);
  } else {
    await startForeground(port);
  }
}
