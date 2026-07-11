import { AppRepo } from '../db/repos.js';
import { forceReleaseLock } from '../utils/lock-utils.js';
import { Logger } from '../utils/logger.js';

export const unlock = async ({ name }: { name: string }) => {
  Logger.info(`Unlocking app: ${Logger.highlight(name)}...`);
  // ✅ Remove database check - unlock should work even if app doesn't exist in DB
  // This allows unlocking stale locks from deleted apps
  forceReleaseLock(name);
};
