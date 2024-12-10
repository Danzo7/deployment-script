import { createHash } from 'crypto';
import { Logger } from './logger.js';
import fs from 'fs';
import path from 'path';
export const calculateFileHash = (filePath: string): string => {
  if (!fs.existsSync(filePath)) return '';
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(fileContent).digest('hex');
};

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
export const isDirectoryEmpty = (dir: string): boolean =>
  fs.existsSync(dir) &&
  fs.statSync(dir).isDirectory() &&
  fs.readdirSync(dir).length === 0;

export const ensureDirectories = (appDir: string) => {
  const relDir = path.join(appDir, 'release');
  const envDir = path.join(appDir, 'env');
  const logDir = path.join(appDir, 'logs');
  Logger.info(`Checking directories...`);
  if (!fs.existsSync(relDir)) {
    fs.mkdirSync(relDir, { recursive: true });
    Logger.success(`Created directory ${relDir}`);
  }
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
    Logger.success(`created directory ${envDir}`);
  }

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    Logger.success(`created directory ${logDir}`);
  }
  return { relDir, envDir, logDir };
};
