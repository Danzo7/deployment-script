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

  Logger.info(`Setting environment variable.....`);

  setEnv(envDir, envName, envValue);

  Logger.success(
    `To apply the changes, run: ${Logger.highlight(`dm deploy ${name}`)}`
  );
};

/**
 * Launches the interactive TUI env editor for the given app.
 * Works in both REPL (navigation push) and CLI (direct bootstrapApp) contexts.
 */
export const launchEnvEditorForApp = async (name: string): Promise<void> => {
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');
  
  await launchPage({
    pageId: PageId.EnvEditor,
    params: { appName: name },
    fullScreen: true,
    onResult: (savedCount: number) => {
      if (savedCount > 0) {
        Logger.success(
          `Saved ${savedCount} change${savedCount === 1 ? '' : 's'} to ${name}.`
        );
        Logger.advice(
          `Run ${Logger.highlight(`dm deploy ${name}`)} to apply the changes.`
        );
      }
    },
  });
};
