import { AppRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { setEnv } from "../utils/env-heper.js";
const setEnvForApp = async ({
  name,
  envName,
  envValue
}) => {
  Logger.info(`Setting environment variable for ${Logger.highlight(name)}...`);
  const app = await AppRepo.findByName(name);
  const { envDir } = ensureDirectories(app.appDir);
  Logger.info(`Setting environment variable.....`);
  setEnv(envDir, envName, envValue);
  Logger.success(
    `To apply the changes, run: ${Logger.highlight(`dm deploy ${name}`)}`
  );
};
const launchEnvEditorForApp = async (name) => {
  const { launchEnvEditor } = await import("../tui/launch-env-editor.js");
  await launchEnvEditor(name);
};
export {
  launchEnvEditorForApp,
  setEnvForApp
};
