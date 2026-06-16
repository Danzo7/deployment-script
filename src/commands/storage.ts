import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { STORAGE_DIR } from '../constants.js';
import { AppRepo, StorageRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export const storageNew = async (name: string): Promise<void> => {
  const storagePath = path.join(STORAGE_DIR, name);
  fs.mkdirSync(storagePath, { recursive: true });
  StorageRepo.add({ name, path: storagePath });
  Logger.success(
    `Storage ${Logger.highlight(name)} created at ${Logger.highlight(storagePath)}.`
  );
};

export const storageAttach = async (
  appName: string,
  storageName: string
): Promise<void> => {
  // Verify app exists (throws if not found)
  const app = AppRepo.findByName(appName);

  // Verify storage exists (throws if not found)
  StorageRepo.findByName(storageName);

  // Check if storage is already attached
  if (app.linkedStorages?.includes(storageName)) {
    throw new Error(
      `Storage "${storageName}" is already attached to "${appName}"`
    );
  }

  // If app has an activeBuild that exists on disk, check for conflicts before writing to DB
  if (app.activeBuild) {
    let activeBuildExists = false;
    try {
      fs.lstatSync(app.activeBuild);
      activeBuildExists = true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (activeBuildExists) {
      const symlinkPath = path.join(app.activeBuild, storageName);
      let stat: fs.Stats | null = null;
      try {
        stat = fs.lstatSync(symlinkPath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
        // path does not exist — no conflict
      }

      if (stat !== null) {
        if (stat.isSymbolicLink()) {
          // Check if it points to the correct target
          const currentTarget = fs.readlinkSync(symlinkPath);
          const expectedTarget = path.join(STORAGE_DIR, storageName);
          if (currentTarget !== expectedTarget) {
            throw new Error(
              `Cannot attach: a symlink "${storageName}" already exists in the active build pointing to a different target ("${currentTarget}").`
            );
          }
          // Correct symlink already exists — no conflict, fall through to DB update
        } else {
          // Real file or directory — Path_Conflict
          throw new Error(
            `Cannot attach: a real directory "${storageName}" already exists in the active build. Remove or rename it first.`
          );
        }
      }
    }
  }

  // All conflict checks passed — update DB
  AppRepo.update(appName, {
    linkedStorages: [...(app.linkedStorages ?? []), storageName],
  });

  // Create symlink in active build if it exists on disk and no correct symlink is already there
  if (app.activeBuild) {
    let activeBuildExists = false;
    try {
      fs.lstatSync(app.activeBuild);
      activeBuildExists = true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (activeBuildExists) {
      const symlinkPath = path.join(app.activeBuild, storageName);
      const expectedTarget = path.join(STORAGE_DIR, storageName);

      // Only create symlink if path doesn't already exist
      let symlinkExists = false;
      try {
        const existingStat = fs.lstatSync(symlinkPath);
        if (existingStat.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(symlinkPath);
          if (currentTarget === expectedTarget) {
            symlinkExists = true; // Already correct, skip
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
        // Does not exist — we'll create it
      }

      if (!symlinkExists) {
        fs.mkdirSync(expectedTarget, { recursive: true });
        fs.symlinkSync(expectedTarget, symlinkPath);
      }
    }
  }

  Logger.success(
    `Storage ${Logger.highlight(storageName)} attached to ${Logger.highlight(appName)}.`
  );
};

export const storageDetach = async (
  appName: string,
  storageName: string
): Promise<void> => {
  // Verify app exists (throws if not found)
  const app = AppRepo.findByName(appName);

  // Check that storage is actually attached
  if (!app.linkedStorages?.includes(storageName)) {
    throw new Error(`Storage "${storageName}" is not attached to "${appName}"`);
  }

  // Remove storage from linkedStorages
  AppRepo.update(appName, {
    linkedStorages: (app.linkedStorages ?? []).filter((s) => s !== storageName),
  });

  // Remove symlink from active build if it exists
  if (app.activeBuild) {
    const symlinkPath = path.join(app.activeBuild, storageName);
    try {
      fs.lstatSync(symlinkPath);
      fs.unlinkSync(symlinkPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      // path does not exist — nothing to unlink
    }
  }

  Logger.success(
    `Storage ${Logger.highlight(storageName)} detached from ${Logger.highlight(appName)}.`
  );
};

export const storageRm = async (name: string): Promise<void> => {
  // Verify storage exists (throws if not found)
  StorageRepo.findByName(name);

  // Check if any apps still have this storage attached
  const attachedApps = AppRepo.getAll()
    .filter((app) => app.linkedStorages?.includes(name))
    .map((app) => app.name);

  if (attachedApps.length > 0) {
    throw new Error(
      `Storage "${name}" is still attached to the following apps: ${attachedApps.join(', ')}. Detach it from all apps before removing.`
    );
  }

  // Remove from DB
  StorageRepo.remove(name);

  // Remove directory from disk if it exists
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
 * Uses fs.readdirSync with { withFileTypes: true } for efficient traversal.
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
 * < 1024        → X B
 * < 1024²       → X.XX KB
 * < 1024³       → X.XX MB
 * else          → X.XX GB
 */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const storageLs = async (): Promise<void> => {
  const storages = StorageRepo.getAll();

  if (storages.length === 0) {
    Logger.info('No storages have been created');
    return;
  }

  const apps = AppRepo.getAll();

  let totalBytes = 0;

  for (const storage of storages) {
    const sizeBytes = getDirectorySize(storage.path);
    totalBytes += sizeBytes;

    const attachedApps = apps
      .filter((app) => app.linkedStorages?.includes(storage.name))
      .map((app) => app.name);

    const attachedAppsDisplay =
      attachedApps.length > 0 ? attachedApps.join(', ') : '(none)';

    console.log(`Name:      ${storage.name}`);
    console.log(`Path:      ${storage.path}`);
    console.log(`Created:   ${storage.createdAt}`);
    console.log(`Apps:      ${attachedAppsDisplay}`);
    console.log(`Size:      ${formatSize(sizeBytes)}`);
    console.log('');
  }

  console.log(`Total size: ${formatSize(totalBytes)}`);
};
