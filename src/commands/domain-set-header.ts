import { normalizeDomainName } from '../utils/route-validation.js';
import { validateHeaderKey } from '../utils/header-merge.js';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export async function domainSetHeader(name: string, key: string, value: string): Promise<void> {
  // 1. Normalize domain name
  const normalized = normalizeDomainName(name);

  // 2. Look up domain — throws if not found
  const domain = await DomainRepo.findByName(normalized);

  // 3. Validate header key
  validateHeaderKey(key);

  // 4. Set/overwrite key in domain.headers (initialize to {} if undefined)
  const headers: Record<string, string> = domain.headers ?? {};
  headers[key] = value;

  // 5. Persist update
  await DomainRepo.update(normalized, {
    headers,
    updatedAt: new Date(),
  });

  // 6. Log success
  Logger.success(`Header "${key}" set on domain "${normalized}".`);
}
