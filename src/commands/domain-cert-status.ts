import * as fs from 'fs';
import chalk from 'chalk';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { CERT_EXPIRY_WARNING_DAYS } from '../utils/ssl-helper.js';
import { formatDate, formatRelative } from '../utils/date-helper.js';

function expiryColored(expiresAt?: string): string {
  if (!expiresAt) return chalk.gray('—');
  const expiry = new Date(expiresAt);
  const now = new Date();
  const warningThreshold = new Date(
    now.getTime() + CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000
  );
  const formatted = `${formatDate(expiresAt)} (${formatRelative(expiresAt)})`;
  if (expiry < now) return chalk.red(formatted + ' EXPIRED');
  if (expiry < warningThreshold)
    return chalk.yellow(formatted + ' expiring soon');
  return chalk.green(formatted);
}

export async function domainCertStatus(name: string): Promise<void> {
  const normalized = name.toLowerCase().trim();
  const domain = await DomainRepo.findByName(normalized);
  if (!domain) {
    throw new Error(`Domain "${normalized}" not found`);
  }

  const { ssl } = domain;

  if (ssl.mode === 'none') {
    Logger.info(`No certificate configured for "${normalized}".`);
    return;
  }

  if (ssl.mode === 'letsencrypt') {
    Logger.info("Let's Encrypt mode is not yet supported.");
    return;
  }

  // mode === 'custom'
  if (!ssl.certPath) {
    Logger.nl();
    Logger.print(chalk.bold.cyan(`  ${domain.name}`));
    Logger.divider();
    Logger.row('SSL Mode', chalk.yellow('custom (no cert uploaded)'));
    Logger.nl();
    return;
  }

  if (!fs.existsSync(ssl.certPath)) {
    Logger.warn(`Certificate file missing from disk: ${ssl.certPath}`);
  }

  Logger.nl();
  Logger.print(chalk.bold.cyan(`  ${domain.name}`));
  Logger.divider();
  Logger.row('SSL Mode', chalk.white(ssl.mode));
  Logger.row('Issued To', chalk.white(ssl.issuedTo ?? '—'));
  Logger.row('Issuer', chalk.white(ssl.issuer ?? '—'));
  Logger.row('SANs', chalk.white(ssl.sanDomains?.join(', ') ?? '—'));
  Logger.row('Uploaded At', chalk.yellow(formatDate(ssl.uploadedAt)));
  Logger.row('Expires', expiryColored(ssl.expiresAt));
  Logger.nl();
}
