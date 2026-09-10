import {
  normalizeDomainName,
  normalizePath
} from "../utils/route-validation.js";
import { DomainRepo, RouteRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
async function routeRemoveHeader(domainName, location, key) {
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);
  const domain = await DomainRepo.findByName(normalizedDomain);
  const route = await RouteRepo.findByDomainAndPath(domain.id, normalizedPath);
  if (!route) {
    throw new Error(
      `No route found for "/${normalizedPath}" on domain "${normalizedDomain}"`
    );
  }
  if (!route.headers || !(key in route.headers)) {
    throw new Error(
      `Header "${key}" is not set on route "/${normalizedPath}" of domain "${normalizedDomain}"`
    );
  }
  const headers = { ...route.headers };
  delete headers[key];
  await RouteRepo.update(route.id, { headers });
  Logger.success(
    `Header "${key}" removed from route "/${normalizedPath}" of domain "${normalizedDomain}".`
  );
}
export {
  routeRemoveHeader
};
