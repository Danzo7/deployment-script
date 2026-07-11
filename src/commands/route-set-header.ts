import {
  normalizeDomainName,
  normalizePath,
} from '../utils/route-validation.js';
import { validateHeaderKey } from '../utils/header-merge.js';
import { DomainRepo, RouteRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export async function routeSetHeader(
  domainName: string,
  location: string,
  key: string,
  value: string
): Promise<void> {
  // 1. Normalize domain name and path
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);

  // 2. Look up domain — throws if not found
  const domain = await DomainRepo.findByName(normalizedDomain);

  // 3. Look up route — throw if not found
  const route = await RouteRepo.findByDomainAndPath(domain.id, normalizedPath);
  if (!route) {
    throw new Error(
      `No route found for "/${normalizedPath}" on domain "${normalizedDomain}"`
    );
  }

  // 4. Validate header key
  validateHeaderKey(key);

  // 5. Set/overwrite key in route.headers (initialize to {} if undefined)
  const headers: Record<string, string> = route.headers ?? {};
  headers[key] = value;

  // 6. Update route in database
  await RouteRepo.update(route.id, { headers });

  // 7. Log success
  Logger.success(
    `Header "${key}" set on route "/${normalizedPath}" of domain "${normalizedDomain}".`
  );
}
