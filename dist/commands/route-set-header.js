import {
  normalizeDomainName,
  normalizePath
} from "../utils/route-validation.js";
import { validateHeaderKey } from "../utils/header-merge.js";
import { DomainRepo, RouteRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
async function routeSetHeader(domainName, location, key, value) {
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);
  const domain = await DomainRepo.findByName(normalizedDomain);
  const route = await RouteRepo.findByDomainAndPath(domain.id, normalizedPath);
  if (!route) {
    throw new Error(
      `No route found for "/${normalizedPath}" on domain "${normalizedDomain}"`
    );
  }
  validateHeaderKey(key);
  const headers = route.headers ?? {};
  headers[key] = value;
  await RouteRepo.update(route.id, { headers });
  Logger.success(
    `Header "${key}" set on route "/${normalizedPath}" of domain "${normalizedDomain}".`
  );
}
export {
  routeSetHeader
};
