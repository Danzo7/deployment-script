import type { Domain, Route } from '../db/model.js';

/**
 * Normalizes a domain name string:
 * - Strips leading http:// or https://
 * - Lowercases
 * - Strips trailing slash
 */
export function normalizeDomainName(s: string): string {
  let result = s;
  result = result.replace(/^https?:\/\//i, '');
  result = result.toLowerCase();
  result = result.replace(/\/+$/, '');
  return result;
}

/**
 * Normalizes a URL path string for storage (without leading slash):
 * - Lowercases
 * - Strips leading slashes
 * - Collapses consecutive / into single /
 * - Strips trailing /
 * - Empty string means root path ("/")
 * NOTE: The path is stored WITHOUT a leading slash. Add "/" when displaying or
 * generating nginx config (e.g. '/' + route.path, or '/' for empty root).
 */
export function normalizePath(s: string): string {
  let result = s.toLowerCase();

  // Collapse consecutive slashes
  result = result.replace(/\/+/g, '/');

  // Strip leading slashes
  result = result.replace(/^\/+/, '');

  // Strip trailing slashes
  result = result.replace(/\/+$/, '');

  return result;
}

/**
 * Returns true if s is a valid hostname or IPv4 dotted-decimal address.
 *
 * Valid hostname: one or more labels separated by dots.
 * Each label: alphanumeric + hyphens, no leading/trailing hyphen, 1–63 chars.
 *
 * Valid IPv4: four decimal octets 0–255 separated by dots.
 */
export function validateHostname(s: string): boolean {
  if (!s || s.length === 0) return false;

  // Check for valid IPv4
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = s.match(ipv4Pattern);
  if (ipv4Match) {
    return ipv4Match.slice(1).every((octet) => {
      const n = parseInt(octet, 10);
      return n >= 0 && n <= 255;
    });
  }

  // Check for valid hostname labels
  const labels = s.split('.');
  if (labels.length === 0) return false;

  return labels.every((label) => {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    return /^[a-zA-Z0-9-]+$/.test(label);
  });
}

/**
 * Throws if a route with the same domainId and path already exists.
 */
export function assertPathUnique(
  routes: Route[],
  domainId: string,
  normalizedPath: string,
  domainName: string
): void {
  const existing = routes.find((r) => r.domainId === domainId && r.path === normalizedPath);
  if (existing) {
    throw new Error(`Path "/${normalizedPath}" is already registered on domain "${domainName}"`);
  }
}

/**
 * Throws if a route with the same domainId and appName already exists.
 */
export function assertAppUniqueOnDomain(
  routes: Route[],
  domainId: string,
  appName: string,
  domainName: string
): void {
  const existing = routes.find((r) => r.domainId === domainId && r.appName === appName);
  if (existing) {
    throw new Error(`App "${appName}" is already routed under domain "${domainName}"`);
  }
}

/**
 * Throws if the app already has a route anywhere across all domains.
 * Looks up the domain name from the domains array to compose the error message.
 */
export function assertAppNotRoutedElsewhere(
  routes: Route[],
  appName: string,
  domains: Domain[]
): void {
  const existing = routes.find((r) => r.appName === appName);
  if (existing) {
    const domain = domains.find((d) => d.id === existing.domainId);
    const domainName = domain ? domain.name : existing.domainId;
    const displayPath = existing.path === '' ? '/' : '/' + existing.path;
    throw new Error(
      `App "${appName}" is already routed at ${domainName}${displayPath}. Use --force to add another route.`
    );
  }
}
