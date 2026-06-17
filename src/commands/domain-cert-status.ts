import * as fs from 'fs';
import chalk from 'chalk';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { CERT_EXPIRY_WARNING_DAYS } from '../utils/ssl-helper.js';

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

export async function domainCertStatus(name: string): Promise<void> {
  const normalized = name.toLowerCase().trim();
  const domain = DomainRepo.findByName(normalized);
  if (!domain) {
    throw new Error(`Domain "${normalized}" not found`);
  }

  const row = (label: string, value: string) =>
    console.log(`  ${chalk.gray(label.padEnd(18))} ${value}`);

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
    console.log();
    console.log(chalk.bold.cyan(`  ${domain.name}`));
    console.log(chalk.gray('  ' + '─'.repeat(40)));
    row('SSL Mode', chalk.yellow('custom (no cert uploaded)'));
    console.log();
    return;
  }

  if (!fs.existsSync(ssl.certPath)) {
    Logger.warn(`Certificate file missing from disk: ${ssl.certPath}`);
  }

  console.log();
  console.log(chalk.bold.cyan(`  ${domain.name}`));
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  row('SSL Mode', chalk.white(ssl.mode));
  row('Issued To', chalk.white(ssl.issuedTo ?? '—'));
  row('Issuer', chalk.white(ssl.issuer ?? '—'));
  row('SANs', chalk.white(ssl.sanDomains?.join(', ') ?? '—'));
  row('Uploaded At', chalk.yellow(ssl.uploadedAt ?? '—'));
  row('Expires', expiryColored(ssl.expiresAt));
  console.log();
}
