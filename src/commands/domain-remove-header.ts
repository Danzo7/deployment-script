import { normalizeDomainName } from '../utils/route-validation.js';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export async function domainRemoveHeader(
  name: string,
  key: string
): Promise<void> {
  // 1. Normalize domain name
  const normalized = normalizeDomainName(name);

  // 2. Look up domain — throws if not found
  const domain = await DomainRepo.findByName(normalized);

  // 3. Throw if the key is not present
  if (!domain.headers || !(key in domain.headers)) {
    throw new Error(`Header "${key}" is not set on domain "${normalized}"`);
  }

  // 4. Delete key from domain.headers
  const headers: Record<string, string> = { ...domain.headers };
  delete headers[key];

  // 5. Persist update
  await DomainRepo.update(normalized, {
    headers,
    updatedAt: new Date(),
  });

  // 6. Log success
  Logger.success(`Header "${key}" removed from domain "${normalized}".`);
}
