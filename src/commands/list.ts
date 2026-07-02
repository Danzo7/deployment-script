import { AppWithStorages } from '../db/model.js';
import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo } from '../db/repos.js';
import { getAppStatus } from '../utils/pm2-helper.js';
import { getAppRouteLines } from './domain.js';

const TYPE_MAP: Record<string, string> = {
  nextjs: '⚡ Next.js',
  nestjs: '🦁 NestJS',
  dotnet: '🔷 .NET',
};

export const listApps = async (filterType?: string) => {
  let apps: (AppWithStorages & { status?: string; routes?: string[] })[] = await AppRepo.getAllWithStorages();

  // Filter by project type if requested
  if (filterType) {
    const normalized = filterType.toLowerCase();
    apps = apps.filter((a) => a.projectType.toLowerCase() === normalized);
    if (apps.length === 0) {
      console.log(chalk.yellow(`No apps found with type "${filterType}".`));
      return;
    }
  }

  for (const app of apps) {
    app.status = await getAppStatus(app.name);
    app.routes = await getAppRouteLines(app.name);
  }

  // Compute dynamic widths based on terminal width
  const termWidth = process.stdout.columns || 120;
  // Fixed columns: Port(8), Status(12), Instances(11), Type(12) + borders/padding (6 cols * 3 = ~18)
  const fixedWidth = 8 + 12 + 11 + 12 + 18;
  const remaining = Math.max(termWidth - fixedWidth, 60);
  // Distribute remaining space: name 25%, storages 30%, routes 45%
  const nameW = Math.max(15, Math.floor(remaining * 0.25));
  const storageW = Math.max(18, Math.floor(remaining * 0.30));
  const routesW = Math.max(24, remaining - nameW - storageW);

  const table = new Table({
    head: [
      chalk.cyan('Name'),
      chalk.cyan('Port'),
      chalk.cyan('Status'),
      chalk.cyan('Inst'),
      chalk.cyan('Type'),
      chalk.cyan('Storages'),
      chalk.cyan('Routes'),
    ],
    colWidths: [nameW, 8, 12, 11, 12, storageW, routesW],
    wordWrap: true,
    style: { 'padding-left': 1, 'padding-right': 1 },
  });

  for (const app of apps) {
    const statusColor =
      app.status === 'online'
        ? chalk.green
        : app.status === 'offline'
          ? chalk.red
          : app.status === 'stopped'
            ? chalk.yellow
            : chalk.gray;

    const typeDisplay = TYPE_MAP[app.projectType] ?? app.projectType ?? 'N/A';

    const storageDisplay =
      app.storages && app.storages.length > 0
        ? app.storages.map((s) => s.name).join('\n')
        : chalk.gray('None');

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

  console.log(table.toString());
};
