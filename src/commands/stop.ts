import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { stopApp } from '../utils/pm2-helper.js';

export const stop = async ({ name }: { name: string }) => {
  await AppRepo.findByName(name);

  Logger.info(`Stopping ${Logger.highlight(name)}...`);
  await stopApp(name);
  Logger.success(`${Logger.highlight(name)} stopped.`);
};
