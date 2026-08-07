import { createHash } from 'crypto';
import { Logger } from './logger.js';
import { Storage } from '../db/model.js';
import fs from 'fs';
import path from 'path';

export const calculateFileHash = (filePath: string): string => {
  if (!fs.existsSync(filePath)) return '';
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(fileContent).digest('hex');
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

/**
 * Returns true if a package.json exists in the given directory.
 */
export const hasPackageJson = (dir: string): boolean =>
  fs.existsSync(path.join(dir, 'package.json'));

/**
 * Creates storage symlinks inside a build directory for each storage.
 * Uses storage.linkName (or storage.name if linkName is not set) as the symlink name and storage.name (via storage.path) as the target.
 * Non-fatal: logs and skips on conflicts rather than throwing.
 *
 * @param buildDir The build directory to create symlinks in
 * @param storages Array of Storage objects to link
 */
export const applyStorageSymlinks = (
  buildDir: string,
  storages: Storage[] = []
): void => {
  for (const storage of storages) {
    const effectiveLinkName = storage.linkName ?? storage.name;
    const linkPath = path.join(buildDir, effectiveLinkName);
    const targetPath = storage.path;

    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        Logger.warn(
          `applyStorageSymlinks: could not stat "${linkPath}": ${err.message}`
        );
        continue;
      }
      // ENOENT — path does not exist, proceed to create symlink
    }

    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(linkPath);
        if (existingTarget === targetPath) {
          // Correct symlink already exists — skip (idempotent)
          continue;
        } else {
          Logger.error(
            `applyStorageSymlinks: stale symlink at "${linkPath}" points to "${existingTarget}" instead of "${targetPath}". Skipping.`
          );
          continue;
        }
      } else {
        Logger.warn(
          `applyStorageSymlinks: a real file or directory already exists at "${linkPath}" (storage: "${storage.name}"). Skipping.`
        );
        continue;
      }
    }

    // Path does not exist — ensure storage directory exists and create symlink
    fs.mkdirSync(targetPath, { recursive: true });
    fs.symlinkSync(targetPath, linkPath);
    Logger.success(
      `Linked storage "${storage.name}" (${effectiveLinkName}) → "${targetPath}"`
    );
  }
};

/**
 * Recursively sums the size of all files in a directory.
 * Returns 0 if the directory does not exist.
 */
export const getDirectorySize = (dirPath: string): number => {
  try {
    fs.statSync(dirPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(fullPath).size;
      } catch {
        // skip files that can't be stat'd
      }
    }
  }
  return total;
};

/**
 * Converts a byte count into a human-readable string.
 * < 1024 → X B, < 1024² → X.XX KB, < 1024³ → X.XX MB, else → X.XX GB
 */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
