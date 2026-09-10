import { AppRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import { stopApp } from "../utils/pm2-helper.js";
const stop = async ({ name }) => {
  await AppRepo.findByName(name);
  Logger.info(`Stopping ${Logger.highlight(name)}...`);
  await stopApp(name);
  Logger.success(`${Logger.highlight(name)} stopped.`);
};
export {
  stop
};
