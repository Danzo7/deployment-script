import { AppRepo } from '../db/repos.js';
import { ensureDirectories } from '../utils/file-utils.js';
import { handleRepo, discardLocalChanges } from '../utils/vcs-helper.js';
import { Logger } from '../utils/logger.js';
import { pruneAllBuilds } from '../utils/build-pruner.js';

export const cleanAll = async () => {
  const apps = AppRepo.getAll();

  if (apps.length === 0) {
    Logger.info('No apps registered.');
    return;
  }

  Logger.info(`Cleaning ${apps.length} app(s)...`);

  const results: { name: string; status: 'ok' | 'failed'; error?: unknown }[] = [];

  for (const app of apps) {
    Logger.info(`\n--- Cleaning: ${app.name} ---`);
    try {
      const { relDir } = ensureDirectories(app.appDir);

      try {
        Logger.isMuted = true;
        await handleRepo(app, relDir);
        Logger.isMuted = false;
        Logger.info(`[${app.name}] Local repository is already clean`);
      } catch {
        Logger.isMuted = false;
        await discardLocalChanges(app, relDir);
      }

      await pruneAllBuilds(app.name);
      results.push({ name: app.name, status: 'ok' });
    } catch (err) {
      Logger.error(`[${app.name}] Failed: ${err}`);
      results.push({ name: app.name, status: 'failed', error: err });
    }
  }

  const failed = results.filter((r) => r.status === 'failed');
  Logger.info(`\nDone. ${results.length - failed.length}/${results.length} app(s) cleaned successfully.`);
  if (failed.length > 0) {
    Logger.warn(`Failed: ${failed.map((r) => r.name).join(', ')}`);
  }
};
