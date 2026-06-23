import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import Table from 'cli-table3';
import chalk from 'chalk';
import { formatDate } from '../utils/date-helper.js';
import { STORAGE_DIR } from '../constants.js';
import { AppRepo, StorageRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { requireSymlinkPermission } from '../utils/os-helper.js';

export const storageNew = async (name: string, linkName?: string): Promise<void> => {
  const storagePath = path.join(STORAGE_DIR, name);
  fs.mkdirSync(storagePath, { recursive: true });
  await StorageRepo.add({ name, linkName: linkName ?? null, path: storagePath });
  const effectiveLinkName = linkName ?? name;
  Logger.success(
    `Storage ${Logger.highlight(name)} created at ${Logger.highlight(storagePath)} (symlink name: ${Logger.highlight(effectiveLinkName)}).`
  );
};

export const storageAttach = async (
  appName: string,
  storageName: string
): Promise<void> => {
  requireSymlinkPermission();

  const app = await AppRepo.findByName(appName);
  const storage = await StorageRepo.findByName(storageName);

  // Check if already attached via junction table
  const existingStorages = await AppRepo.getStoragesByAppId(app.id);
  if (existingStorages.some(s => s.id === storage.id)) {
    throw new Error(`Storage "${storageName}" is already attached to "${appName}"`);
  }

  // Conflict checks against linkName path in active build — before any DB write
  if (app.activeBuild) {
    let activeBuildExists = false;
    try {
      fs.lstatSync(app.activeBuild);
      activeBuildExists = true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (activeBuildExists) {
      const effectiveLinkName = storage.linkName ?? storage.name;
      const symlinkPath = path.join(app.activeBuild, effectiveLinkName);
      let stat: fs.Stats | null = null;
      try {
        stat = fs.lstatSync(symlinkPath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }

      if (stat !== null) {
        if (stat.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(symlinkPath);
          if (currentTarget !== storage.path) {
            throw new Error(
              `Cannot attach: a symlink "${effectiveLinkName}" already exists in the active build pointing to a different target ("${currentTarget}").`
            );
          }
          // Correct symlink — no conflict, fall through
        } else {
          throw new Error(
            `Cannot attach: a real directory "${effectiveLinkName}" already exists in the active build. Remove or rename it first.`
          );
        }
      }
    }
  }

  // All conflict checks passed — create junction table entry
  await AppRepo.linkStorage(app.id, storage.id);

  // Create symlink in active build if it doesn't already exist correctly
  if (app.activeBuild) {
    let activeBuildExists = false;
    try {
      fs.lstatSync(app.activeBuild);
      activeBuildExists = true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (activeBuildExists) {
      const effectiveLinkName = storage.linkName ?? storage.name;
      const symlinkPath = path.join(app.activeBuild, effectiveLinkName);
      let symlinkExists = false;
      try {
        const existingStat = fs.lstatSync(symlinkPath);
        if (existingStat.isSymbolicLink() && fs.readlinkSync(symlinkPath) === storage.path) {
          symlinkExists = true;
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }

      if (!symlinkExists) {
        fs.mkdirSync(storage.path, { recursive: true });
        fs.symlinkSync(storage.path, symlinkPath);
      }
    }
  }

  Logger.success(
    `Storage ${Logger.highlight(storageName)} attached to ${Logger.highlight(appName)} as ${Logger.highlight(storage.linkName ?? storage.name)}.`
  );
};

export const storageDetach = async (
  appName: string,
  storageName: string
): Promise<void> => {
  const app = await AppRepo.findByName(appName);
  const storage = await StorageRepo.findByName(storageName);

  // Check if attached via junction table
  const existingStorages = await AppRepo.getStoragesByAppId(app.id);
  if (!existingStorages.some(s => s.id === storage.id)) {
    throw new Error(`Storage "${storageName}" is not attached to "${appName}"`);
  }

  // Remove from junction table
  await AppRepo.unlinkStorage(app.id, storage.id);

  // Remove symlink using linkName
  if (app.activeBuild) {
    const effectiveLinkName = storage.linkName ?? storage.name;
    const symlinkPath = path.join(app.activeBuild, effectiveLinkName);
    try {
      fs.lstatSync(symlinkPath);
      fs.unlinkSync(symlinkPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  Logger.success(
    `Storage ${Logger.highlight(storageName)} detached from ${Logger.highlight(appName)}.`
  );
};

export const storageRm = async (name: string): Promise<void> => {
  const storage = await StorageRepo.findByName(name);

  // Check if any apps are attached via junction table
  const attachedApps = await AppRepo.findByStorageId(storage.id);

  if (attachedApps.length > 0) {
    const appNames = attachedApps.map(app => app.name);
    throw new Error(
      `Storage "${name}" is still attached to the following apps: ${appNames.join(', ')}. Detach it from all apps before removing.`
    );
  }

  await StorageRepo.remove(name);

  const storagePath = path.join(STORAGE_DIR, name);
  if (fs.existsSync(storagePath)) {
    await fsExtra.remove(storagePath);
  } else {
    Logger.info(
      `Storage directory ${Logger.highlight(storagePath)} not found on disk; skipping removal.`
    );
  }

  Logger.success(`Storage ${Logger.highlight(name)} removed.`);
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

export const storageLs = async (): Promise<void> => {
  const storages = await StorageRepo.getAllWithApps();

  if (storages.length === 0) {
    Logger.info('No storages have been created');
    return;
  }

  let totalBytes = 0;

  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.whiteBright('Name'),
      chalk.blue('Link Name'),
      chalk.magenta('Path'),
      chalk.yellow('Created'),
      chalk.whiteBright('Apps'),
      chalk.green('Size'),
    ],
  });

  storages.forEach((storage, index) => {
    const sizeBytes = getDirectorySize(storage.path);
    totalBytes += sizeBytes;

    const attachedApps = storage.apps.map(app => app.name);
    const attachedAppsDisplay =
      attachedApps.length > 0 ? chalk.whiteBright(attachedApps.join(', ')) : chalk.gray('—');

    const createdAt = formatDate(storage.createdAt, 'N/A');

    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright(storage.name),
      chalk.blue(storage.linkName ?? storage.name),
      chalk.magenta(storage.path),
      chalk.yellow(createdAt),
      attachedAppsDisplay,
      chalk.green(formatSize(sizeBytes)),
    ]);
  });

  table.push([
    { colSpan: 6, content: chalk.gray('Total'), hAlign: 'right' },
    chalk.green(formatSize(totalBytes)),
  ]);

  console.log(table.toString());
};
