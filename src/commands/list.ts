import { AppWithStoragesAndRoutes } from '../db/model.js';
import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo } from '../db/repos.js';
import { getAppStatus, openSharedPm2, closeSharedPm2 } from '../utils/pm2-helper.js';
import { supportsUnicode } from '../utils/terminal-capabilities.js';
import { formatRelative } from '../utils/date-helper.js';
import { CERT_EXPIRY_WARNING_DAYS } from '../utils/ssl-helper.js';

/**
 * Centralised display labels for project types.
 * Emoji are gated behind supportsUnicode so legacy Windows consoles
 * (conhost.exe, build < 17763) see clean plain-text fallbacks instead of
 * blank boxes — emoji rendering is a hard OS-level limitation on those hosts
 * and cannot be fixed via chcp or registry.
 */
const TYPE_MAP: Record<string, string> = {
  nextjs: supportsUnicode ? '⚡ Next.js' : 'Next.js',
  nestjs: supportsUnicode ? '🦁 NestJS'  : 'NestJS',
  dotnet: supportsUnicode ? '🔷 .NET'    : '.NET',
};

/**
 * Format routes for display (extracted from domain.ts getAppRouteLines logic)
 */
function formatAppRoutes(app: AppWithStoragesAndRoutes): string[] {
  if (!app.routes || app.routes.length === 0) return [];

  const lines: string[] = [];

  for (const route of app.routes) {
    const domain = route.domain;
    const pathPart = route.path === '' ? '/' : `/${route.path}`;
    const ssl = domain.ssl;
    const protocol = ssl.mode === 'none' ? 'http' : 'https';
    const url = `${protocol}://${domain.name}${pathPart}`;

    let sslLabel: string;
    if (ssl.mode === 'none') {
      sslLabel = chalk.gray('no SSL');
    } else if (ssl.mode === 'custom' && ssl.expiresAt) {
      const expiry = new Date(ssl.expiresAt);
      const now = new Date();
      const warning = new Date(now.getTime() + CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
      const distance = formatRelative(ssl.expiresAt);
      if (expiry < now) sslLabel = chalk.red(`SSL expired ${distance}`);
      else if (expiry < warning) sslLabel = chalk.yellow(`SSL expires ${distance}`);
      else sslLabel = chalk.green(`SSL valid · expires ${distance}`);
    } else if (ssl.mode === 'custom') {
      sslLabel = chalk.yellow('custom SSL (no cert)');
    } else {
      sslLabel = chalk.cyan(ssl.mode);
    }

    lines.push(`${chalk.magenta(url)}  ${sslLabel}`);
  }

  return lines;
}

export const listApps = async (filterType?: string) => {
  // Fetch all apps with storages and routes (with domains) in a single query
  let apps: (AppWithStoragesAndRoutes & { status?: string; routeDisplay?: string[] })[] = 
    await AppRepo.getAllWithStoragesAndRoutes();

  // Filter by project type if requested
  if (filterType) {
    const normalized = filterType.toLowerCase();
    apps = apps.filter((a) => a.projectType.toLowerCase() === normalized);
    if (apps.length === 0) {
      console.log(chalk.yellow(`No apps found with type "${filterType}".`));
      return;
    }
  }

  await openSharedPm2();
  try {
    for (const app of apps) {
      app.status = await getAppStatus(app.name);
      app.routeDisplay = formatAppRoutes(app);
    }
  } finally {
    closeSharedPm2();
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
      app.routeDisplay && app.routeDisplay.length > 0
        ? app.routeDisplay.join('\n')
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
