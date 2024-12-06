import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo } from '../db/repos.js';
import { App } from '../db/model.js';
import { getAppStatus } from '../utils/pm2-helper.js';
import { format } from 'date-fns';

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
      chalk.whiteBright('Name'), // Removed the color here for a simpler look
      chalk.blue('Port'),
      chalk.yellow('Last Deployed'),
      chalk.whiteBright('Status'),
      chalk.whiteBright('Directory'), // Removed the color here for simplicity
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

    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright(app.name), // No color for the name, just plain text
      chalk.blue.bold(app.port),
      chalk.yellow(lastDeployed),
      statusColor, // Apply color only to the status
      app.appDir, // No color for the directory, just plain text
    ]);
  });

  // Print the table
  console.log(table.toString());
};
