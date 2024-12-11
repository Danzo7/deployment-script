import fs from "fs";
import path from "path";
import { calculateFileHash } from "./file-utils.js";
import { Logger } from "./logger.js";

export const checkEnv = async (dir: string, envDir: string) => {
    const appEnvPath = path.join(dir, '.env.local');
    const releaseEnvPath = path.join(envDir, '.env.local');
  
    // Check if the .env.local file exists in both locations
    if (fs.existsSync(appEnvPath) && fs.existsSync(releaseEnvPath)) {
      const appEnvHash = calculateFileHash(appEnvPath);
      const releaseEnvHash = calculateFileHash(releaseEnvPath);
      if (appEnvHash !== releaseEnvHash) {
        fs.copyFileSync(releaseEnvPath, appEnvPath);
        Logger.success(
          `Update environment variables`
        );
        return true;
      } else {
        Logger.info('environment variables are up to date. No changes made.');
      }
    } else if (!fs.existsSync(appEnvPath) && fs.existsSync(releaseEnvPath)) {
      fs.copyFileSync(releaseEnvPath, appEnvPath);
      Logger.success(`Pull environment variables`);
      return true;
    } else {
      Logger.info('No .env.local file found.');
    }
    return false;
  };