import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { findAvailablePort } from '../utils/network-utils.js';
import path from 'path';
import { ensureDirectories } from '../utils/file-utils.js';

export const init = async ({
  name,
  repo,
  branch,
  instances,
  port,
  appsDir,
}: {
  name: string;
  repo: string;
  branch: string;
  instances?: number;
  port?: number;
  appsDir: string;
}) => {
  if (!repo) throw new Error('Repository URL is required.');

  // Check if app already exists
  let app = AppRepo.getAll().find((app) => app.name === name);
  if (app) {
    throw new Error(`An app with the name "${name}" already exists.`);
  }

  const appDir = path.join(appsDir, name);
  ensureDirectories(appDir);

  // Find an available port if none is specified
  if (!port) {
    Logger.info('Port not specified. Searching for an available port...');
    port = await findAvailablePort(AppRepo.getAll().map((app) => app.port));
  }

  app = AppRepo.add({
    port,
    repo,
    branch,
    instances,
    name,
    appDir,
  });

  Logger.success(`The app "${Logger.highlight(name)}" was successfully added!`);

  Logger.advice(
    `Next steps: Run ${Logger.command(
      `dm deploy ${name}`
    )} to deploy the app. Use ${Logger.command(`dm list`)} to verify its status.`
  );
};
