import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js';

export const checkLocalFolder = (repo: string): void => {
  if (!fs.existsSync(repo))
    throw new Error(`Local source folder not found: ${repo}`);
  if (!fs.statSync(repo).isDirectory())
    throw new Error(`Local source path is not a directory: ${repo}`);
};

/**
 * Copies the source folder into the release directory.
 * Wipes the destination first so the release always mirrors the source exactly.
 */
export const handleLocalFolder = async ({
  dir,
  repo,
}: {
  dir: string;
  repo: string;
}): Promise<boolean> => {
  if (!fs.existsSync(repo)) {
    throw new Error(`Local source folder not found: ${repo}`);
  }

  const stat = fs.statSync(repo);
  if (!stat.isDirectory()) {
    throw new Error(`Local source path is not a directory: ${repo}`);
  }

  const existed = fs.existsSync(dir);

  // Get mtime before copy to detect whether anything changed
  const srcMtime = getLatestMtime(repo);
  let prevMtime: number | null = null;

  if (existed) {
    const marker = path.join(dir, '.local-source-mtime');
    if (fs.existsSync(marker)) {
      prevMtime = parseInt(fs.readFileSync(marker, 'utf8').trim(), 10);
    }
  }

  if (prevMtime !== null && prevMtime === srcMtime) {
    Logger.info('Local folder is up-to-date. No changes detected.');
    return false;
  }

  Logger.info(`Copying local folder ${repo} → ${dir}`);

  // Wipe and re-copy
  if (existed) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  copyDirSync(repo, dir);

  // Write mtime marker for next-run diffing
  fs.writeFileSync(path.join(dir, '.local-source-mtime'), String(srcMtime));

  Logger.success('Local folder copied successfully.');
  return true;
};

/**
 * Returns a pseudo-revision object derived from the source folder's latest mtime.
 */
export const getLocalFolderRevision = (
  repo: string
): { hash: string; message: string; author: string; date: string } | null => {
  if (!fs.existsSync(repo)) return null;
  const mtime = getLatestMtime(repo);
  const date = new Date(mtime);
  return {
    hash: String(mtime).slice(-7), // last 7 digits of epoch ms → stable short id
    message: 'local folder snapshot',
    author: 'local',
    date: date.toISOString(),
  };
};

/** Recursively copies src → dest (both must exist as dirs). */
function copyDirSync(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Returns the latest mtime (ms) across all files in a directory tree. */
function getLatestMtime(dir: string): number {
  let latest = fs.statSync(dir).mtimeMs;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, getLatestMtime(full));
    } else {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}
