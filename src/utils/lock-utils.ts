import fs from "fs";
import path from "path";
import { Logger } from "./logger.js";
import { LOCK_DIR } from "../constants.js";


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
    throw new Error(`Lock file for app "${appName}" already exists. CLI is already running.`);
  }

  fs.writeFileSync(lockFile, String(process.pid));
  Logger.success(`Lock acquired for app "${appName}".`);
};

/**
 * Releases a lock for a specific app.
 * @param {string} appName - The name of the app.
 */
export const releaseLock = (appName: string) => {
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);

  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    Logger.info(`Lock released for app "${appName}".`);
  }
};