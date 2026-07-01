import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { ensureDirectories } from '../utils/file-utils.js';
import { setEnv } from '../utils/env-heper.js';

export const setEnvForApp = async ({
  name,
  envName,
  envValue,
}: {
  name: string;
  envName: string;
  envValue: string;
}) => {
  Logger.info(`Setting environment variable for ${Logger.highlight(name)}...`);

  const app = await AppRepo.findByName(name);

  const { envDir } = ensureDirectories(app.appDir);

  Logger.info(
    `Setting environment variable.....`
  );

 setEnv(envDir, envName, envValue);

    Logger.success(
      `To apply the changes, run: ${Logger.highlight(`dm deploy ${name}`)}`
    );
 
};

/**
 * Launches the interactive TUI env editor for the given app.
 * Imported lazily so the ink/React dependencies only load when needed.
 */
export const launchEnvEditorForApp = async (name: string): Promise<void> => {
  const { launchEnvEditor } = await import('../tui/launch-env-editor.js');
  await launchEnvEditor(name);
};
