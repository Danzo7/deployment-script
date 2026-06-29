import { AppWithStorages } from '../db/model.js';
import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo } from '../db/repos.js';
import { getAppStatus } from '../utils/pm2-helper.js';
import { getAppRouteLines } from './domain.js';

export const listApps = async () => {
  // Read apps with storages eagerly loaded via database join
  const apps: (AppWithStorages & { status?: string; routes?: string[] })[] = await AppRepo.getAllWithStorages();

  // Fetch the status and routes of each app
  for (const app of apps) {
    app.status = await getAppStatus(app.name);
    app.routes = await getAppRouteLines(app.name);
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
      chalk.cyan('Routes'),
    ],
    colWidths: [20, 10, 15, 12, 10, 30, 50],
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

    // Format routes similar to info command
    const routesDisplay = 
      app.routes && app.routes.length > 0
        ? app.routes.join('\n')
        : chalk.gray('None');

    table.push([
      chalk.white(app.name),
      chalk.white(app.port.toString()),
      statusColor(app.status || 'unknown'),
      chalk.white(app.instances?.toString() || '1'),
      chalk.white(typeDisplay),
      storageDisplay,
      routesDisplay,
    ]);
  }

  // Print the table
  console.log(table.toString());
};
