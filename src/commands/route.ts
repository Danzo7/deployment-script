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

  AppRepo.findByName(appName);
  const domain = DomainRepo.findByName(normalizedDomain);

  if (!force) {
    assertAppNotRoutedElsewhere(RouteRepo.getAll(), appName, DomainRepo.getAll());
  }

  assertPathUnique(RouteRepo.getAll(), domain.id, normalizedPath, normalizedDomain);
  assertAppUniqueOnDomain(RouteRepo.getAll(), domain.id, appName, normalizedDomain);

  RouteRepo.add({ domainId: domain.id, path: normalizedPath, appName });

  Logger.success(
    `App ${Logger.highlight(appName)} routed to ${Logger.highlight(normalizedDomain)} at ${Logger.highlight('/' + normalizedPath)}.`
  );
}

export async function routeRemove(domainName: string, location: string): Promise<void> {
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);

  const domain = DomainRepo.findByName(normalizedDomain);
  const route = RouteRepo.findByDomainAndPath(domain.id, normalizedPath);

  if (!route) {
    throw new Error(
      `No route found for "/${normalizedPath}" on domain "${normalizedDomain}"`
    );
  }

  RouteRepo.remove(route.id);

  Logger.success(
    `Route ${Logger.highlight('/' + normalizedPath)} on ${Logger.highlight(normalizedDomain)} removed.`
  );
}

export async function routeList(domainName: string): Promise<void> {
  const normalized = normalizeDomainName(domainName);
  const domain = DomainRepo.findByName(normalized);

  const routes = RouteRepo.getAll().filter((r) => r.domainId === domain.id);

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
      chalk.blue(route.appName),
    ]);
  });

  console.log(table.toString());
}
