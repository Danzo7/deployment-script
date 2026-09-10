import fs from "fs";
import path from "path";
import { LOCK_DIR } from "../constants.js";
import { Logger } from "./logger.js";
const ensureLockDir = () => {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR);
  }
};
const acquireLock = (appName) => {
  ensureLockDir();
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);
  if (fs.existsSync(lockFile)) {
    throw new Error(`CLI for ${appName} is already running.`);
  }
  fs.writeFileSync(lockFile, String(process.pid));
};
const releaseLock = (appName) => {
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
};
const forceReleaseLock = (appName) => {
  const lockFile = path.join(LOCK_DIR, `${appName}.lock`);
  if (!fs.existsSync(lockFile)) {
    Logger.info(`No lock found for application "${appName}".`);
    return;
  }
  try {
    const pid = parseInt(fs.readFileSync(lockFile, "utf8"), 10);
    if (isNaN(pid)) {
      Logger.warn(
        `Invalid PID in lock file for application "${appName}". Removing lock file.`
      );
      fs.unlinkSync(lockFile);
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      Logger.info(`Process with PID ${pid} terminated.`);
    } catch (err) {
      if (err.code === "ESRCH") {
        Logger.warn(`Process with PID ${pid} is not running.`);
      } else {
        Logger.warn(
          `Failed to kill process ${pid}: ${err.message}. Removing lock file anyway.`
        );
      }
    }
    fs.unlinkSync(lockFile);
    Logger.success(`Lock for application "${appName}" has been released.`);
  } catch (err) {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        Logger.warn(`Lock file removed despite error: ${err.message}`);
      }
    } catch {
    }
    throw new Error(
      `Failed to release lock for application "${appName}": ${err.message}`
    );
  }
};
export {
  acquireLock,
  forceReleaseLock,
  releaseLock
};
