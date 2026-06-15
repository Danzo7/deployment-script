import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export const setUrl = ({ name, url }: { name: string; url: string }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  AppRepo.update(name, { url });
  Logger.success(`URL for ${Logger.highlight(name)} set to ${Logger.highlight(url)}`);
};
