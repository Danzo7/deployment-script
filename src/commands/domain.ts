import chalk from 'chalk';
import Table from 'cli-table3';
import { format } from 'date-fns';
import  {DomainRepo, RouteRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { normalizeDomainName, validateHostname } from '../utils/route-validation.js';
import { CERT_EXPIRY_WARNING_DAYS } from '../utils/ssl-helper.js';
import type { Domain } from '../db/model.js';

export async function domainAdd(name: string): Promise<void> {
  const normalized = normalizeDomainName(name);
  if (!validateHostname(normalized)) {
    throw new Error(`"${normalized}" is not a valid hostname`);
  }
  DomainRepo.add({ name: normalized });
  Logger.success(`Domain ${Logger.highlight(normalized)} added.`);
}

export async function domainRemove(name: string, force: boolean): Promise<void> {
  const normalized = normalizeDomainName(name);
  const domain = DomainRepo.findByName(normalized);
  const routes = RouteRepo.getAll().filter((r) => r.domainId === domain.id);

  if (routes.length > 0 && !force) {
    const routeLines = routes.map((r) => `  /${r.path} → ${r.appName}`).join('\n');
    throw new Error(
      `Domain "${normalized}" has routes:\n${routeLines}\nUse --force to cascade delete.`
    );
  }

  if (routes.length > 0 && force) {
    RouteRepo.removeByDomainId(domain.id);
  }

  DomainRepo.remove(normalized);
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
  if (expiry < now) return chalk.red(expiresAt + ' (EXPIRED)');
  if (expiry < warningThreshold) return chalk.yellow(expiresAt + ' (expiring soon)');
  return chalk.green(expiresAt);
}

export async function domainList(): Promise<void> {
  const domains = DomainRepo.getAll();

  if (domains.length === 0) {
    Logger.info('No domains have been added');
    return;
  }

  const allRoutes = RouteRepo.getAll();

  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.whiteBright('Name'),
      chalk.blue('Routes'),
      chalk.magenta('SSL'),
    ],
  });

  domains.forEach((domain, index) => {
    const routeCount = allRoutes.filter((r) => r.domainId === domain.id).length;

    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright(domain.name),
      chalk.blue(routeCount.toString()),
      sslColumnValue(domain),
    ]);
  });

  console.log(table.toString());
}

export async function domainShow(name: string): Promise<void> {
  const normalized = normalizeDomainName(name);
  const domain = DomainRepo.findByName(normalized);
  const routes = RouteRepo.getAll().filter((r) => r.domainId === domain.id);

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
      row('Uploaded', chalk.yellow(domain.ssl.uploadedAt ?? '—'));
    }
  }
  row('Created', chalk.yellow(format(new Date(domain.createdAt), 'yyyy-MM-dd HH:mm:ss')));
  row('Updated', chalk.yellow(format(new Date(domain.updatedAt), 'yyyy-MM-dd HH:mm:ss')));
  console.log(chalk.gray('  ' + '─'.repeat(40)));

  if (routes.length === 0) {
    console.log(`  ${chalk.gray('No routes configured')}`);
  } else {
    for (const route of routes) {
      console.log(`  ${chalk.white('/' + route.path)}  →  ${chalk.whiteBright(route.appName)}`);
    }
  }

  console.log();
}

export async function domainSsl(
  name: string,
  mode: 'none' | 'letsencrypt' | 'custom'
): Promise<void> {
  const normalized = normalizeDomainName(name);
  DomainRepo.findByName(normalized);
  DomainRepo.update(normalized, { ssl: { mode } });
  Logger.success(`SSL mode for ${Logger.highlight(normalized)} set to ${Logger.highlight(mode)}.`);
}
