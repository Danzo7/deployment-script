import { createHash } from "crypto";
import { Logger } from "./logger.js";
import fs from "fs";
import path from "path";
export const calculateFileHash = (filePath: string): string => {
    if(!fs.existsSync(filePath)) return "";
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(fileContent).digest('hex');
  };
  

 export const checkEnv = async (dir: string,envDir: string) => {
    Logger.info("Checking environment variables..."); 
      const appEnvPath = path.join(dir, '.env.local');
      const releaseEnvPath = path.join(envDir, '.env.local');
  
      // Check if the .env.local file exists in both locations
      if (fs.existsSync(appEnvPath) && fs.existsSync(releaseEnvPath)) {
        const appEnvHash = calculateFileHash(appEnvPath);
        const releaseEnvHash = calculateFileHash(releaseEnvPath);
          if (appEnvHash !== releaseEnvHash) {
          fs.copyFileSync(releaseEnvPath, appEnvPath);
          Logger.success(`Overwritten .env.local in ${dir} with the one from ${envDir}`);
          return true;
        } else {
          Logger.info('.env.local is up to date. No changes made.');
        }
      } else if (!fs.existsSync(appEnvPath)&&fs.existsSync(releaseEnvPath)) { 
        fs.copyFileSync(releaseEnvPath, appEnvPath);
        Logger.success(`Copied .env.local from ${dir} to ${envDir}`);
        return true
      } else {
        Logger.info('No .env.local file found.');
      }
      return false;
  };
  export const isDirectoryEmpty = (dir: string): boolean => fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
