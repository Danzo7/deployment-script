import { normalizeDomainName, normalizePath } from '../utils/route-validation.js';
import { DomainRepo, RouteRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export async function routeRemoveHeader(
  domainName: string,
  location: string,
  key: string
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

  // 4. Throw if the key is not present in route.headers
  if (!route.headers || !(key in route.headers)) {
    throw new Error(
      `Header "${key}" is not set on route "/${normalizedPath}" of domain "${normalizedDomain}"`
    );
  }

  // 5. Delete key from route.headers
  const headers: Record<string, string> = { ...route.headers };
  delete headers[key];

  // 6. Update route in database
  await RouteRepo.update(route.id, { headers });

  // 7. Log success
  Logger.success(
    `Header "${key}" removed from route "/${normalizedPath}" of domain "${normalizedDomain}".`
  );
}
