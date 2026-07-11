import pm2 from 'pm2';
import fs from 'fs';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

/** Truncate a log file to empty if it exists. */
function clearFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
    }
  } catch {
    // ignore missing / permission errors silently
  }
}

/** Clear PM2 log files for a single named process. */
async function clearLogsForProcess(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    pm2.describe(name, (err, list) => {
      if (err || !list?.length) return resolve();
      const env = list[0].pm2_env as any;
      clearFile(env?.pm_out_log_path);
      clearFile(env?.pm_err_log_path);
      resolve();
    });
  });
}

export const logClear = async ({
  name,
  all,
}: {
  name?: string;
  all?: boolean;
}) => {
  await new Promise<void>((resolve, reject) => {
    pm2.connect((connectErr) => {
      if (connectErr)
        return reject(new Error(`Failed to connect to pm2: ${connectErr}`));
      resolve();
    });
  });

  try {
    if (all) {
      const apps = await AppRepo.getAll();
      for (const app of apps) {
        await clearLogsForProcess(app.name);
        Logger.info(`Cleared logs for "${Logger.highlight(app.name)}"`);
      }
      Logger.info('All app logs cleared.');
    } else {
      if (!name)
        throw new Error(
          'Provide an app <name> or use --all to clear all logs.'
        );
      await AppRepo.findByName(name);
      await clearLogsForProcess(name);
      Logger.info(`Logs cleared for "${Logger.highlight(name)}".`);
    }
  } finally {
    pm2.disconnect();
  }
};
