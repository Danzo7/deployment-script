import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { stopApp } from '../utils/pm2-helper.js';

export const stop = async ({ name }: { name: string }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  Logger.info(`Stopping ${Logger.highlight(name)}...`);
  await stopApp(name);
  Logger.success(`${Logger.highlight(name)} stopped.`);
};
