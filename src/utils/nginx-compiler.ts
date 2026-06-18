import fs from 'node:fs';
import type { Domain, Route, App } from '../db/model.js';
import { PROXY_TARGET_HOST } from '../constants.js';
import { PROXY_SET_HEADERS, mergeHeaders } from '../utils/header-merge.js';

// ─── Task 7.1: Apex detection helper ────────────────────────────────────────

// Label-count apex check — not public-suffix-list-aware. `foo.co.uk` will be treated as a subdomain.
function isApex(domainName: string): boolean {
  return domainName.split('.').length === 2;
}

// ─── Task 7.2: hasSsl evaluation ────────────────────────────────────────────

function evaluateHasSsl(domain: Domain): boolean {
  const { mode, certPath, keyPath } = domain.ssl;

  if (mode === 'letsencrypt') {
    throw new Error(`Let's Encrypt mode is not yet supported by the compiler`);
  }

  if (mode !== 'custom') {
    return false;
  }

  // Check certPath first, then keyPath
  if (!certPath || !fs.existsSync(certPath)) {
    const missingPath = certPath ?? '';
    throw new Error(
      `SSL certificate file missing for domain "${domain.name}": ${missingPath}`
    );
  }

  if (!keyPath || !fs.existsSync(keyPath)) {
    const missingPath = keyPath ?? '';
    throw new Error(
      `SSL certificate file missing for domain "${domain.name}": ${missingPath}`
    );
  }

  return true;
}

// ─── Task 7.3: Location block builder ───────────────────────────────────────

function buildLocationBlocks(
  domain: Domain,
  routes: Route[],
  apps: App[],
  hasSsl: boolean
): string {
  const indent = '    ';
  const blocks: string[] = [];

  // Sort routes descending by path length (most specific first)
  const sortedRoutes = [...routes].sort((a, b) => b.path.length - a.path.length);

  for (const route of sortedRoutes) {
    const app = apps.find((a) => a.name === route.appName);
    if (!app) {
      throw new Error(
        `App "${route.appName}" not found for route "${route.path}" on domain "${domain.name}"`
      );
    }

    const locationPath = route.path === '' ? '/' : '/' + route.path;
    const lines: string[] = [];
    lines.push(`${indent}location ${locationPath} {`);

    // proxy_pass
    lines.push(`${indent}${indent}proxy_pass http://${PROXY_TARGET_HOST}:${app.port};`);

    // Standard proxy_set_header entries from PROXY_SET_HEADERS
    for (const [name, value] of PROXY_SET_HEADERS) {
      lines.push(`${indent}${indent}proxy_set_header ${name} ${value};`);
    }

    // Project-type-specific additions
    if (app.projectType === 'nextjs') {
      lines.push(`${indent}${indent}proxy_http_version 1.1;`);
      lines.push(`${indent}${indent}proxy_set_header Upgrade $http_upgrade;`);
      lines.push(`${indent}${indent}proxy_set_header Connection "upgrade";`);
      lines.push(`${indent}${indent}proxy_buffering off;`);
    } else if (app.projectType === 'nestjs') {
      lines.push(`${indent}${indent}proxy_http_version 1.1;`);
    }

    // Merged add_header entries
    const merged = mergeHeaders(domain, route, hasSsl);
    for (const [key, value] of Object.entries(merged)) {
      lines.push(`${indent}${indent}add_header ${key} "${value}" always;`);
    }

    lines.push(`${indent}}`);
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}

// ─── Task 7.4: Server block builder ─────────────────────────────────────────

const COMMON_DIRECTIVES = [
  '    server_tokens off;',
  '    client_max_body_size 20m;',
  '    gzip on;',
  '    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;',
].join('\n');

const SSL_DIRECTIVES = (certPath: string, keyPath: string): string =>
  [
    `    ssl_certificate ${certPath};`,
    `    ssl_certificate_key ${keyPath};`,
    '    ssl_protocols TLSv1.2 TLSv1.3;',
    '    ssl_prefer_server_ciphers off;',
    '    ssl_session_cache shared:SSL:10m;',
    '    ssl_session_timeout 10m;',
  ].join('\n');

function buildServerBlocks(
  domain: Domain,
  locationBlocks: string,
  hasSsl: boolean,
  wwwIsRegisteredDomain: boolean
): string {
  const domainName = domain.name;
  const apex = isApex(domainName);

  // Case 1: No SSL
  if (!hasSsl) {
    const serverNameLine =
      apex && !wwwIsRegisteredDomain
        ? `    server_name ${domainName} www.${domainName};`
        : `    server_name ${domainName};`;

    return [
      'server {',
      '    listen 80;',
      serverNameLine,
      '',
      COMMON_DIRECTIVES,
      '',
      locationBlocks,
      '}',
    ].join('\n');
  }

  // SSL cases — certPath and keyPath are guaranteed non-empty by evaluateHasSsl
  const certPath = domain.ssl.certPath!;
  const keyPath = domain.ssl.keyPath!;

  // Case 2: hasSsl === true AND apex AND www NOT a registered domain (three blocks)
  if (apex && !wwwIsRegisteredDomain) {
    const block1 = [
      'server {',
      '    listen 80;',
      `    server_name ${domainName} www.${domainName};`,
      `    return 301 https://$host$request_uri;`,
      '}',
    ].join('\n');

    const block2 = [
      'server {',
      '    listen 443 ssl;',
      `    server_name www.${domainName};`,
      '',
      SSL_DIRECTIVES(certPath, keyPath),
      '',
      `    return 301 https://${domainName}$request_uri;`,
      '}',
    ].join('\n');

    const block3 = [
      'server {',
      '    listen 443 ssl;',
      `    server_name ${domainName};`,
      '',
      SSL_DIRECTIVES(certPath, keyPath),
      '',
      COMMON_DIRECTIVES,
      '',
      locationBlocks,
      '}',
    ].join('\n');

    return [block1, block2, block3].join('\n\n');
  }

  // Case 3: hasSsl === true AND (NOT apex OR www IS a registered domain) (two blocks)
  const block1 = [
    'server {',
    '    listen 80;',
    `    server_name ${domainName};`,
    `    return 301 https://$host$request_uri;`,
    '}',
  ].join('\n');

  const block2 = [
    'server {',
    '    listen 443 ssl;',
    `    server_name ${domainName};`,
    '',
    SSL_DIRECTIVES(certPath, keyPath),
    '',
    COMMON_DIRECTIVES,
    '',
    locationBlocks,
    '}',
  ].join('\n');

  return [block1, block2].join('\n\n');
}

// ─── Task 7.5: Export compileDomainConfig ────────────────────────────────────

/**
 * Compiles a complete Nginx server block configuration for a domain.
 *
 * Pure function — same inputs always produce the same output.
 * NOTE: "pure" here means no DB/repo access. fs.existsSync is called for cert
 * path validation (required to fail loudly on stale paths).
 *
 * @param domain     - the Domain record
 * @param routes     - all Route records that belong to this domain
 * @param apps       - all App records (used to resolve port by appName)
 * @param allDomains - full domain list from DomainRepo.getAll(); used to check
 *                     whether www.<domainName> is already an explicitly registered
 *                     domain. Required — omitting it would silently skip the
 *                     www-conflict check and risk emitting duplicate server_name blocks.
 * @returns complete Nginx config as a string (ends with trailing newline)
 * @throws if a required App is missing, cert files are absent, or SSL mode is unsupported
 */
export function compileDomainConfig(
  domain: Domain,
  routes: Route[],
  apps: App[],
  allDomains: Domain[]
): string {
  // www-conflict check: determine if www.<domainName> is already a registered domain
  const wwwIsRegisteredDomain = allDomains.some(
    (d) => d.name === 'www.' + domain.name
  );

  // Evaluate SSL readiness (throws for letsencrypt or missing cert files)
  const hasSsl = evaluateHasSsl(domain);

  // Build location blocks (throws if an App is missing)
  const locationBlocks = buildLocationBlocks(domain, routes, apps, hasSsl);

  // Build the full server block(s)
  const config = buildServerBlocks(domain, locationBlocks, hasSsl, wwwIsRegisteredDomain);

  // Ensure trailing newline
  return config.endsWith('\n') ? config : config + '\n';
}
