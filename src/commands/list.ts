import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo, StorageRepo } from '../db/repos.js';
import { App } from '../db/model.js';
import { getAppStatus } from '../utils/pm2-helper.js';
import { format } from 'date-fns';
import { getDirectorySize, formatSize } from './storage.js';

export const listApps = async () => {
  // Read the directory to get all apps
  const apps: (App & { status?: string })[] = AppRepo.getAll();

  // Fetch the status of each app
  await Promise.all(
    apps.map(async (app) => {
      app.status = await getAppStatus(app.name);
    })
  );

  // Create a table
  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.whiteBright('Name'),
      chalk.blue('Port'),
      chalk.magenta('Type'),
      chalk.yellow('Last Deployed'),
      chalk.whiteBright('Status'),
      chalk.whiteBright('Directory'),
      chalk.green('Storages'),
    ],
    style: {
      compact: false, // Make sure the table looks more spaced out
    },
  });

  // Push the data into the table with conditional styling
  apps.forEach((app, index) => {
    const statusColor =
      app.status === 'online'
        ? chalk.green(app.status)
        : app.status === 'stopped'
          ? chalk.red(app.status)
          : app.status === 'launching'
            ? chalk.yellow(app.status)
            : chalk.gray.italic(app.status);

    const lastDeployed = app.lastDeploy
      ? format(new Date(app.lastDeploy), 'yyyy-MM-dd HH:mm:ss')
      : 'N/A';

    const storageDisplay =
      (app.linkedStorages ?? []).length === 0
        ? chalk.gray('—')
        : (app.linkedStorages ?? [])
            .map((storageName) => {
              try {
                const storage = StorageRepo.findByName(storageName);
                const size = formatSize(getDirectorySize(storage.path));
                return `${chalk.white(storageName)} ${chalk.gray('(')}${chalk.green(size)}${chalk.gray(')')}`;
              } catch {
                return chalk.gray(`${storageName} (not found)`);
              }
            })
            .join('\n');

    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright(app.name),
      chalk.blue.bold(app.port),
      chalk.magenta(app.projectType),
      chalk.yellow(lastDeployed),
      statusColor,
      app.appDir,
      storageDisplay,
    ]);
  });

  // Print the table
  console.log(table.toString());
};
