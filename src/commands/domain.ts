import chalk from 'chalk';
import Table from 'cli-table3';
import { formatDate, formatRelative } from '../utils/date-helper.js';
import  {AppRepo, DomainRepo, RouteRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { normalizeDomainName, validateHostname } from '../utils/route-validation.js';
import { CERT_EXPIRY_WARNING_DAYS } from '../utils/ssl-helper.js';
import type { Domain } from '../db/model.js';

export async function domainAdd(name: string): Promise<void> {
  const normalized = normalizeDomainName(name);
  if (!validateHostname(normalized)) {
    throw new Error(`"${normalized}" is not a valid hostname`);
  }
  await DomainRepo.add({ name: normalized });
  Logger.success(`Domain ${Logger.highlight(normalized)} added.`);
}

export async function domainRemove(name: string, force: boolean): Promise<void> {
  const normalized = normalizeDomainName(name);
  const domain = await DomainRepo.findByName(normalized);
  const routes = await RouteRepo.getAllByDomainIdWithApp(domain.id);

  if (routes.length > 0 && !force) {
    const routeLines = routes.map((r) => `  /${r.path} → ${r.app.name}`).join('\n');
    throw new Error(
      `Domain "${normalized}" has routes:\n${routeLines}\nUse --force to cascade delete.`
    );
  }

  if (routes.length > 0 && force) {
    await RouteRepo.removeByDomainId(domain.id);
  }

  await DomainRepo.remove(normalized);
  Logger.success(`Domain ${Logger.highlight(normalized)} removed.`);
}

function sslColumnValue(domain: Domain): string {
  if (domain.ssl.mode === 'custom') {
    return domain.ssl.certPath
      ? chalk.green('custom ✓')
      : chalk.yellow('custom (no cert)');
  }
  return domain.ssl.mode === 'none'
    ? chalk.gray('none')
    : chalk.white(domain.ssl.mode);
}

function expiryColored(expiresAt?: string): string {
  if (!expiresAt) return chalk.gray('—');
  const expiry = new Date(expiresAt);
  const now = new Date();
  const warningThreshold = new Date(
    now.getTime() + CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000
  );
  const formatted = `${formatDate(expiresAt)} (${formatRelative(expiresAt)})`;
  if (expiry < now) return chalk.red(formatted + ' EXPIRED');
  if (expiry < warningThreshold) return chalk.yellow(formatted + ' expiring soon');
  return chalk.green(formatted);
}

export async function getAppRouteLines(appName: string): Promise<string[]> {
  const app = await AppRepo.findByName(appName);
  const routes = await RouteRepo.getAllByAppIdWithAppAndDomain(app.id);
  if (routes.length === 0) return [];

  const lines: string[] = [];

  for (const route of routes) {
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

export async function domainList(): Promise<void> {
  const domains = await DomainRepo.getAllWithRoutes();

  if (domains.length === 0) {
    Logger.info('No domains have been added');
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.whiteBright('Name'),
      chalk.blue('Routes'),
      chalk.magenta('SSL'),
      chalk.green('Pushed'),
    ],
  });

  domains.forEach((domain, index) => {
    const routeCount = domain.routes.length;
    
    let pushedValue: string;
    if (domain.lastPushedAt) {
      const relativeTime = formatRelative(domain.lastPushedAt);
      const isStale = domain.lastCompiledAt && new Date(domain.lastCompiledAt) > new Date(domain.lastPushedAt);
      pushedValue = isStale 
        ? chalk.yellow(`⚠ ${relativeTime}`)
        : chalk.green(relativeTime);
    } else {
      pushedValue = chalk.gray('—');
    }

    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright(domain.name),
      chalk.blue(routeCount.toString()),
      sslColumnValue(domain),
      pushedValue,
    ]);
  });

  console.log(table.toString());
}

export async function domainShow(name: string): Promise<void> {
  const normalized = normalizeDomainName(name);
  const domain = await DomainRepo.findByNameWithRoutes(normalized);

  const row = (label: string, value: string) =>
    console.log(`  ${chalk.gray(label.padEnd(18))} ${value}`);

  console.log();
  console.log(chalk.bold.cyan(`  ${domain.name}`));
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  row('Name', chalk.white(domain.name));
  row('SSL Mode', chalk.white(domain.ssl.mode));
  if (domain.ssl.mode === 'custom') {
    if (!domain.ssl.certPath) {
      row('SSL', chalk.yellow('custom (no cert uploaded)'));
    } else {
      row('Issued To', chalk.white(domain.ssl.issuedTo ?? '—'));
      row('Expires', expiryColored(domain.ssl.expiresAt));
      row('Uploaded', chalk.yellow(formatDate(domain.ssl.uploadedAt)));
    }
  }
  row('Created', chalk.yellow(formatDate(domain.createdAt)));
  row('Updated', chalk.yellow(formatDate(domain.updatedAt)));
  
  // Push metadata section
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  if (domain.lastPushedAt) {
    row('Last pushed', chalk.yellow(`${formatDate(domain.lastPushedAt)} (${formatRelative(domain.lastPushedAt)})`));
  } else {
    row('Last pushed', chalk.gray('—'));
  }
  if (domain.configPath) {
    row('Config path', chalk.white(domain.configPath));
  } else {
    row('Config path', chalk.gray('—'));
  }
  
  // Staleness warnings
  if (domain.lastCompiledAt && !domain.lastPushedAt) {
    console.log();
    console.log(`  ${chalk.yellow('⚠')} Config has been compiled but not yet pushed. Run ${chalk.cyan(`'dm domain push ${name}'`)} to deploy.`);
  } else if (domain.lastCompiledAt && domain.lastPushedAt && new Date(domain.lastCompiledAt) > new Date(domain.lastPushedAt)) {
    console.log();
    console.log(`  ${chalk.yellow('⚠')} Config is stale — recompiled since last push. Run ${chalk.cyan(`'dm domain push ${name}'`)} to update.`);
  }
  
  console.log(chalk.gray('  ' + '─'.repeat(40)));

  if (domain.routes.length === 0) {
    console.log(`  ${chalk.gray('No routes configured')}`);
  } else {
    for (const route of domain.routes) {
      console.log(`  ${chalk.white('/' + route.path)}  →  ${chalk.whiteBright(route.app.name)}`);
    }
  }

  console.log();
}
