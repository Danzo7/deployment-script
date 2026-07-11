import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { ensureDirectories } from '../utils/file-utils.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';

export const restart = async ({ name }: { name: string }) => {
  const app = await AppRepo.findByName(name);

  if (!app.builds?.length || !app.activeBuild) {
    throw new Error(
      `No build found for "${Logger.highlight(name)}". Run ${Logger.command(`dm deploy ${name}`)} first.`
    );
  }

  const buildDir = await AppRepo.resolveActiveBuild(name);
  if (!buildDir) {
    throw new Error(`No active build found for "${Logger.highlight(name)}".`);
  }

  const { logDir } = ensureDirectories(app.appDir);
  const status = await getAppStatus(name);

  Logger.info(`Restarting ${Logger.highlight(name)}...`);
  await runApp(buildDir, {
    name: app.name,
    port: app.port,
    instances: app.instances,
    status,
    output: path.join(logDir, 'pm2.out.log'),
    error: path.join(logDir, 'pm2.error.log'),
    projectType: app.projectType,
  });

  Logger.success(`${Logger.highlight(name)} restarted successfully.`);
};
