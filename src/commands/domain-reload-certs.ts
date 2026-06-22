import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import {
  getCertStorePath,
  loadCertFromStore,
  buildSSLConfig,
} from '../utils/ssl-helper.js';

/**
 * Reloads certificates from disk for all domains or a specific domain.
 * 
 * This command scans the certificate storage folder (Cert_Store) for each domain
 * and synchronizes the database with the actual certificate files on disk.
 * 
 * Behavior:
 * - If cert and key files exist on disk but not in DB → adds certificate to DB
 * - If cert and key files exist on disk and in DB → updates certificate metadata in DB
 * - If certificate exists in DB but files missing on disk → warns and removes SSL from domain
 * 
 * Use cases:
 * - Easy way to load certificates after manual file placement
 * - Refresh certificate metadata after manual certificate replacement
 * - Detect and fix mismatches between filesystem and database state
 */
export async function domainReloadCerts(name?: string): Promise<void> {
  if (name) {
    // Reload specific domain
    const normalized = name.toLowerCase().trim();
    const domain = DomainRepo.findByName(normalized);
    if (!domain) {
      throw new Error(`Domain "${normalized}" not found`);
    }
    await reloadDomainCert(normalized);
  } else {
    // Reload all domains
    const domains = DomainRepo.getAll();
    if (domains.length === 0) {
      Logger.info('No domains found.');
      return;
    }

    console.log();
    Logger.info(`Reloading certificates for ${domains.length} domain(s)...`);
    console.log();

    let updated = 0;
    let added = 0;
    let removed = 0;
    let skipped = 0;

    for (const domain of domains) {
      const result = await reloadDomainCert(domain.name, true);
      if (result === 'updated') updated++;
      else if (result === 'added') added++;
      else if (result === 'removed') removed++;
      else skipped++;
    }

    console.log();
    Logger.success(`Certificate reload complete.`);
    console.log(chalk.gray(`  Added: ${added}, Updated: ${updated}, Removed: ${removed}, Skipped: ${skipped}`));
    console.log();
  }
}

/**
 * Reloads certificate for a single domain
 * @returns 'added' | 'updated' | 'removed' | 'skipped'
 */
async function reloadDomainCert(
  domainName: string,
  quiet = false
): Promise<'added' | 'updated' | 'removed' | 'skipped'> {
  const domain = DomainRepo.findByName(domainName);
  if (!domain) {
    throw new Error(`Domain "${domainName}" not found`);
  }

  const certStoreDir = getCertStorePath(domainName);
  const certPath = path.join(certStoreDir, 'cert.pem');
  const keyPath = path.join(certStoreDir, 'key.pem');

  const certExists = fs.existsSync(certPath);
  const keyExists = fs.existsSync(keyPath);
  const dbHasCert = domain.ssl.mode === 'custom' && domain.ssl.certPath;

  // Case 1: Files exist on disk
  if (certExists && keyExists) {
    try {
      // Load and validate certificate from disk
      const { certPath, keyPath, metadata } = loadCertFromStore(domainName);

      // Update or add certificate to database
      DomainRepo.update(domainName, buildSSLConfig({
        certPath,
        keyPath,
        uploadedAt: dbHasCert ? domain.ssl.uploadedAt : undefined,
        metadata,
      }));

      if (!quiet) {
        if (dbHasCert) {
          Logger.success(`Certificate refreshed for "${domainName}". Expires: ${metadata.expiresAt}`);
        } else {
          Logger.success(`Certificate loaded for "${domainName}". Expires: ${metadata.expiresAt}`);
        }
      }

      return dbHasCert ? 'updated' : 'added';
    } catch (err: any) {
      if (!quiet) {
        Logger.error(`Failed to load certificate for "${domainName}": ${err.message}`);
      }
      return 'skipped';
    }
  }

  // Case 2: Files missing but DB expects certificate
  if (dbHasCert && (!certExists || !keyExists)) {
    const missing = [];
    if (!certExists) missing.push('cert.pem');
    if (!keyExists) missing.push('key.pem');

    Logger.warn(
      `Certificate files missing for "${domainName}": ${missing.join(', ')}. Removing SSL configuration from database.`
    );

    DomainRepo.update(domainName, { ssl: { mode: 'none' } });

    return 'removed';
  }

  // Case 3: No files and no DB cert (nothing to do)
  if (!quiet && !dbHasCert) {
    // Only show this in non-quiet mode and when running for single domain
    if (domainName) {
      Logger.info(`No certificate configured for "${domainName}".`);
    }
  }

  return 'skipped';
}
