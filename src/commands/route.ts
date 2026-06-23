import Table from 'cli-table3';
import chalk from 'chalk';
import { AppRepo, DomainRepo, RouteRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import {
  normalizeDomainName,
  normalizePath,
  assertPathUnique,
  assertAppUniqueOnDomain,
  assertAppNotRoutedElsewhere,
} from '../utils/route-validation.js';

export async function routeAdd(
  appName: string,
  domainName: string,
  location: string,
  force: boolean
): Promise<void> {
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);

  const app = await AppRepo.findByName(appName);
  const domain = await DomainRepo.findByName(normalizedDomain);

  const allRoutes = await RouteRepo.getAllWithApp();
  const allDomains = await DomainRepo.getAll();

  if (!force) {
    assertAppNotRoutedElsewhere(allRoutes, app, allDomains);
  }

  assertPathUnique(allRoutes, domain.id, normalizedPath, normalizedDomain);
  assertAppUniqueOnDomain(allRoutes, domain.id, app, normalizedDomain);

  await RouteRepo.add({ domainId: domain.id, path: normalizedPath, appId: app.id });

  Logger.success(
    `App ${Logger.highlight(appName)} routed to ${Logger.highlight(normalizedDomain)} at ${Logger.highlight('/' + normalizedPath)}.`
  );
}

export async function routeRemove(domainName: string, location: string): Promise<void> {
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);

  const domain = await DomainRepo.findByName(normalizedDomain);
  const route = await RouteRepo.findByDomainAndPath(domain.id, normalizedPath);

  if (!route) {
    throw new Error(
      `No route found for "/${normalizedPath}" on domain "${normalizedDomain}"`
    );
  }

  await RouteRepo.remove(route.id);

  Logger.success(
    `Route ${Logger.highlight('/' + normalizedPath)} on ${Logger.highlight(normalizedDomain)} removed.`
  );
}

export async function routeList(domainName: string): Promise<void> {
  const normalized = normalizeDomainName(domainName);
  const domain = await DomainRepo.findByName(normalized);

  const routes = await RouteRepo.getAllByDomainIdWithApp(domain.id);

  if (routes.length === 0) {
    Logger.info(`No routes configured for domain "${domain.name}"`);
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.whiteBright('Path'),
      chalk.blue('App'),
    ],
  });

  routes.forEach((route, index) => {
    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright('/' + route.path),
      chalk.blue(route.app.name),
    ]);
  });

  console.log(table.toString());
}
