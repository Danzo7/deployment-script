import fs from 'fs';
import path from 'path';
import { LOCK_DIR } from '../constants.js';
import { Logger } from './logger.js';
import { randomUUID } from 'crypto';
import { validateResourceName } from './managed-path.js';

const ownedLocks = new Map<string, string>();
const lockPath = (appName: string) => {
  validateResourceName(appName);
  return path.join(LOCK_DIR, `${appName}.lock`);
};

/**
 * Ensures the lock directory exists.
 */
const ensureLockDir = () => {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
};

/**
 * Acquires a lock for a specific app.
 * @param {string} appName - The name of the app.
 * @throws {Error} If the lock already exists.
 */
export const acquireLock = (appName: string) => {
  const lockFile = lockPath(appName);
  ensureLockDir();
  const contents = `${process.pid}\n${randomUUID()}`;
  try {
    fs.writeFileSync(lockFile, contents, { flag: 'wx', mode: 0o600 });
  } catch (err: any) {
    if (err.code === 'EEXIST') throw new Error(`CLI for ${appName} is already running.`);
    throw err;
  }
  ownedLocks.set(lockFile, contents);
};

/**
 * Releases a lock for a specific app.
 * @param {string} appName - The name of the app.
 */
export const releaseLock = (appName: string) => {
  const lockFile = lockPath(appName);
  const contents = ownedLocks.get(lockFile);
  if (!contents) return;
  try {
    if (fs.readFileSync(lockFile, 'utf8') === contents) fs.unlinkSync(lockFile);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  } finally {
    ownedLocks.delete(lockFile);
  }
};
// Helper function to forcibly release the lock
export const forceReleaseLock = (appName: string) => {
  const lockFile = lockPath(appName);

  // Check if the lock file exists
  if (!fs.existsSync(lockFile)) {
    Logger.info(`No lock found for application "${appName}".`);
    return; // ✅ Exit early if no lock exists
  }

  try {
    // Read the PID from the lock file
    const pid = parseInt(fs.readFileSync(lockFile, 'utf8'), 10);

    if (isNaN(pid)) {
      // ✅ Delete corrupt lock file even if PID is invalid
      Logger.warn(
        `Invalid PID in lock file for application "${appName}". Removing lock file.`
      );
      fs.unlinkSync(lockFile);
      return;
    }

    // Check if the process is still running and kill it
    try {
      process.kill(pid, 'SIGTERM'); // Attempt a graceful shutdown
      Logger.info(`Process with PID ${pid} terminated.`);
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        Logger.warn(`Process with PID ${pid} is not running.`);
      } else {
        // ✅ Still remove lock file even if kill fails with unexpected error
        Logger.warn(
          `Failed to kill process ${pid}: ${err.message}. Removing lock file anyway.`
        );
      }
    }

    // ✅ Always remove the lock file
    fs.unlinkSync(lockFile);
    Logger.success(`Lock for application "${appName}" has been released.`);
  } catch (err: any) {
    // ✅ Attempt to remove lock file even on error
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        Logger.warn(`Lock file removed despite error: ${err.message}`);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(
      `Failed to release lock for application "${appName}": ${err.message}`
    );
  }
};
