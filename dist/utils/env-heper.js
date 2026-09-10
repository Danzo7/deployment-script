import fs from "fs";
import path from "path";
import { calculateFileHash } from "./file-utils.js";
import { Logger } from "./logger.js";
const checkEnv = async (dir, envDir, envName) => {
  const appEnvPath = path.join(dir, ".env.local");
  const releaseEnvPath = path.join(envDir, envName);
  if (fs.existsSync(appEnvPath) && fs.existsSync(releaseEnvPath)) {
    const appEnvHash = calculateFileHash(appEnvPath);
    const releaseEnvHash = calculateFileHash(releaseEnvPath);
    if (appEnvHash !== releaseEnvHash) {
      fs.copyFileSync(releaseEnvPath, appEnvPath);
      Logger.success(`Update environment variables`);
      return true;
    } else {
      Logger.info("Environment variables are up to date. No changes made.");
    }
  } else if (!fs.existsSync(appEnvPath) && fs.existsSync(releaseEnvPath)) {
    fs.copyFileSync(releaseEnvPath, appEnvPath);
    Logger.success(`Pull environment variables`);
    return true;
  } else {
    Logger.info(`No ${envName} file found`);
  }
  return false;
};
const setEnv = (dir, envName, envValue) => {
  const appEnvPath = path.join(dir, ".env.local");
  let envFileContent = fs.existsSync(appEnvPath) ? fs.readFileSync(appEnvPath, "utf-8") : "";
  const regex = new RegExp(`^${envName}=.*$`, "m");
  if (regex.test(envFileContent)) {
    envFileContent = envFileContent.replace(regex, `${envName}=${envValue}`);
    Logger.info(`Updated environment variable: ${envName}`);
  } else {
    envFileContent += `
${envName}=${envValue}`;
    Logger.info(`Added new environment variable: ${envName}`);
  }
  fs.writeFileSync(appEnvPath, envFileContent, "utf-8");
};
export {
  checkEnv,
  setEnv
};
