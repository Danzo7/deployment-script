import { AppRepo } from "../db/repos.js";
import { forceReleaseLock } from "../utils/lock-utils.js";
import { Logger } from "../utils/logger.js";


export const unlock = async ({
  name,

}: {
  name: string;
}) => {
  Logger.info(`Unlocking app: ${Logger.highlight(name)}...`);
  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) {
    throw new Error(
      `App "${Logger.highlight(name)}" not found.\n` 
    );
  }
  forceReleaseLock(name);

};
