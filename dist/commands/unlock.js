import { forceReleaseLock } from "../utils/lock-utils.js";
import { Logger } from "../utils/logger.js";
const unlock = async ({ name }) => {
  Logger.info(`Unlocking app: ${Logger.highlight(name)}...`);
  forceReleaseLock(name);
};
export {
  unlock
};
