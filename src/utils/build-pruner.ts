import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { AppRepo } from '../db/repos.js';
import { Logger } from './logger.js';
import { withBackoffRetry } from './retry-helper.js';

const MAX_BUILDS = 3;

/**
 * Unlinks the node_modules symlink first to avoid Windows handle issues,
 * then removes the full build directory with backoff retries.
 */
const removeBuildDir = async (buildPath: string): Promise<void> => {
  const symlink = path.join(buildPath, 'node_modules');
  if (fs.existsSync(symlink)) {
    try {
      fs.unlinkSync(symlink);
    } catch {
      // non-fatal — removal will retry below
    }
  }

  await withBackoffRetry(
    `Remove ${path.basename(buildPath)}`,
    () => fsExtra.remove(buildPath),
    5,
    2000
  );
};

/**
 * Shared removal logic: iterates builds, shows spinner, updates DB.
 */
const removeBuilds = async (appName: string, buildPaths: string[]): Promise<void> => {
  if (buildPaths.length === 0) return;
  Logger.info(`Removing ${buildPaths.length} old build(s) for "${appName}"...`);

  for (const buildPath of buildPaths) {
    try {
      await Logger.spinner(
        `Removing old build: ${path.basename(buildPath)}`,
        () => removeBuildDir(buildPath)
      );
      AppRepo.removeBuild(appName, buildPath);
    } catch {
      Logger.warn(
        `Could not remove "${path.basename(buildPath)}" — skipping. Run ${Logger.command('dm clean')} to retry.`
      );
    }
  }
};

/**
 * Called after a successful deploy. Keeps at most MAX_BUILDS builds,
 * removing the oldest non-active ones with retries to handle Windows file locks.
 */
export const pruneOldBuilds = async (appName: string): Promise<void> => {
  const app = AppRepo.getAll().find((a) => a.name === appName);
  if (!app?.builds || app.builds.length <= MAX_BUILDS) return;

  const buildsToRemove = app.builds
    .map((buildPath, index) => ({ buildPath, index }))
    .filter(({ index }) => index !== app.activeBuild)
    .slice(0, app.builds.length - MAX_BUILDS);

  await removeBuilds(appName, buildsToRemove.map((b) => b.buildPath));
};

/**
 * Called by `dm clean`. Removes all non-active builds regardless of count.
 */
export const pruneAllBuilds = async (appName: string): Promise<void> => {
  const app = AppRepo.getAll().find((a) => a.name === appName);
  if (!app?.builds || app.builds.length === 0) {
    Logger.info("No old builds to clean.");
    return;
  }

  const buildsToRemove = app.builds
    .map((buildPath, index) => ({ buildPath, index }))
    .filter(({ index }) => index !== app.activeBuild)
    .map((b) => b.buildPath);

  if (buildsToRemove.length === 0) {
    Logger.info("No old builds to clean.");
    return;
  }

  await removeBuilds(appName, buildsToRemove);
};
