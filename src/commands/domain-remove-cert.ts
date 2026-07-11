import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { deleteCertFiles } from '../utils/ssl-helper.js';

export async function domainRemoveCert(name: string): Promise<void> {
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
    throw new Error(
      "Let's Encrypt certificates cannot be managed with this command."
    );
  }

  // mode === 'custom'
  deleteCertFiles(normalized);
  await DomainRepo.update(normalized, { ssl: { mode: 'none' } });
  Logger.success(`Certificate removed from "${normalized}".`);
}
