import fs from 'fs';
import path from 'path';
import { LOCK_DIR } from '../constants.js';
import { Logger } from './logger.js';

/**
 * Ensures the lock directory exists.
 */
const ensureLockDir = () => {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR);
  }
};

/**
 * Acquires a lock for a specific app.
 * @param {string} appName - The name of the app.
 * @throws {Error} If the lock already exists.
 */
export const acquireLock = (appName: string) => {
  ensureLockDir();
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);

  if (fs.existsSync(lockFile)) {
    throw new Error(`CLI for ${appName} is already running.`);
  }

  fs.writeFileSync(lockFile, String(process.pid));
};

/**
 * Releases a lock for a specific app.
 * @param {string} appName - The name of the app.
 */
export const releaseLock = (appName: string) => {
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);

  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
};
// Helper function to forcibly release the lock
export const forceReleaseLock = (appName:string) => {
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);

  // Check if the lock file exists
  if (!fs.existsSync(lockFile)) {
    Logger.info(`No lock found for application "${appName}".`);
  }

  try {
    // Read the PID from the lock file
    const pid = parseInt(fs.readFileSync(lockFile, 'utf8'), 10);

    if (isNaN(pid)) {
      throw new Error(`Invalid PID in lock file for application "${appName}".`);
    }

    // Check if the process is still running and kill it
    try {
      process.kill(pid, 'SIGTERM'); // Attempt a graceful shutdown
      Logger.info(`Process with PID ${pid} terminated.`);
    } catch (err:any) {
      if (err.code === 'ESRCH') {
        Logger.warn(`Process with PID ${pid} is not running.`);
      } else {
        throw err;
      }
    }
    fs.unlinkSync(lockFile);
    Logger.success(`Lock for application "${appName}" has been released.`);
  } catch (err:any) {
    throw new Error(`Failed to release lock for application "${appName}": ${err.message}`);
  }
};