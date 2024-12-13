import fs from "fs";
import path from "path";
import { calculateFileHash } from "./file-utils.js";
import { Logger } from "./logger.js";

// Function to check and update environment variables
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
      Logger.info('Environment variables are up to date. No changes made.');
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

// Function to set an environment variable in .env.local
export const setEnv = (dir: string, envName: string, envValue: string) => {
  const appEnvPath = path.join(dir, '.env.local');
  
    let envFileContent = fs.existsSync(appEnvPath)?fs.readFileSync(appEnvPath, 'utf-8'):"";
    const regex = new RegExp(`^${envName}=.*$`, 'm');
    if (regex.test(envFileContent)) {
      envFileContent = envFileContent.replace(regex, `${envName}=${envValue}`);
      Logger.info(`Updated environment variable: ${envName}`);
    } else {
      envFileContent += `\n${envName}=${envValue}`;
      Logger.info(`Added new environment variable: ${envName}`);
    }

    // Write the updated content back to the file
    fs.writeFileSync(appEnvPath, envFileContent, 'utf-8');

};
