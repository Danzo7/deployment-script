import { AppRepo } from '../db/repos.js';
import { forceReleaseLock } from "../utils/lock-utils.js";
import { Logger } from "../utils/logger.js";


export const unlock = async ({
  name,

}: {
  name: string;
}) => {
  Logger.info(`Unlocking app: ${Logger.highlight(name)}...`);
  await AppRepo.findByName(name);
  forceReleaseLock(name);

};
