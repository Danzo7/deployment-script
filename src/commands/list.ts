import { AppWithStorages } from '../db/model.js';
import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo } from '../db/repos.js';
import { getAppStatus } from '../utils/pm2-helper.js';

export const listApps = async () => {
  // Read apps with storages eagerly loaded via database join
  const apps: (AppWithStorages & { status?: string })[] = await AppRepo.getAllWithStorages();

  // Fetch the status of each app
  for (const app of apps) {
    app.status = await getAppStatus(app.name);
  }

  // Create a table
  const table = new Table({
    head: [
      chalk.cyan('Name'),
      chalk.cyan('Port'),
      chalk.cyan('Status'),
      chalk.cyan('Instances'),
      chalk.cyan('Type'),
      chalk.cyan('Linked Storages'),
    ],
    colWidths: [20, 10, 15, 12, 10, 40],
  });

  // Add rows to the table
  for (const app of apps) {
    const statusColor =
      app.status === 'online'
        ? chalk.green
        : app.status === 'offline'
          ? chalk.red
          : app.status === 'stopped'
            ? chalk.yellow
            : chalk.gray;

    // Format project type with emoji
    const typeDisplay = 
      app.projectType === 'nextjs' ? '⚡ Next.js' :
      app.projectType === 'nestjs' ? '🦁 NestJS' :
      app.projectType === 'dotnet' ? '🔷 .NET' :
      app.projectType || 'N/A';

    // Format linked storages from database join
    const storageDisplay = 
      app.storages && app.storages.length > 0
        ? app.storages.map(storage => storage.name).join(', ')
        : chalk.gray('None');

    table.push([
      chalk.white(app.name),
      chalk.white(app.port.toString()),
      statusColor(app.status || 'unknown'),
      chalk.white(app.instances?.toString() || '1'),
      chalk.white(typeDisplay),
      storageDisplay,
    ]);
  }

  // Print the table
  console.log(table.toString());
};
