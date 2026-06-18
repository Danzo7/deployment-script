import fs from 'node:fs';
import path from 'node:path';
import type { Domain, Route, App } from '../db/model.js';
import { PROXY_TARGET_HOST, DOMAINS_DIR, CERT_DIR } from '../constants.js';
import { PROXY_SET_HEADERS, mergeHeaders } from './header-merge.js';
import { normalizeDomainName } from './route-validation.js';
import { DomainRepo, RouteRepo, AppRepo } from '../db/repos.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Label-count apex check — not public-suffix-list-aware. `foo.co.uk` will be treated as a subdomain.
function isApex(domainName: string): boolean {
  return domainName.split('.').length === 2;
}

function evaluateHasSsl(domain: Domain): { hasSsl: boolean; certPath?: string; keyPath?: string } {
  const { mode, certPath, keyPath } = domain.ssl;

  if (mode === 'letsencrypt') {
    throw new Error(`Let's Encrypt mode is not yet supported by the compiler`);
  }

  if (mode !== 'custom') return { hasSsl: false };

  let resolvedCert: string;
  let resolvedKey: string;

  if (CERT_DIR) {
    resolvedCert = path.join(CERT_DIR, domain.name, 'cert.pem');
    resolvedKey  = path.join(CERT_DIR, domain.name, 'key.pem');
  } else {
    if (!certPath || !fs.existsSync(certPath)) {
      throw new Error(`SSL certificate file missing for domain "${domain.name}": ${certPath ?? ''}`);
    }
    if (!keyPath || !fs.existsSync(keyPath)) {
      throw new Error(`SSL key file missing for domain "${domain.name}": ${keyPath ?? ''}`);
    }
    resolvedCert = certPath;
    resolvedKey  = keyPath;
  }

  return { hasSsl: true, certPath: resolvedCert, keyPath: resolvedKey };
}

/** Returns true if the wildcard SAN covers www.<parent>. */
function wildcardCoversWww(san: string, parent: string): boolean {
  return san.startsWith('*.') && san.slice(2).toLowerCase() === parent.toLowerCase();
}

// ─── Block builders ──────────────────────────────────────────────────────────

const INDENT = '    ';

const COMMON_DIRECTIVES = [
  `${INDENT}server_tokens off;`,
  `${INDENT}client_max_body_size 20m;`,
  `${INDENT}gzip on;`,
  `${INDENT}gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;`,
].join('\n');

function sslDirectives(certPath: string, keyPath: string): string {
  return [
    `${INDENT}ssl_certificate ${certPath};`,
    `${INDENT}ssl_certificate_key ${keyPath};`,
    `${INDENT}ssl_protocols TLSv1.2 TLSv1.3;`,
    `${INDENT}ssl_prefer_server_ciphers off;`,
    `${INDENT}ssl_session_cache shared:SSL:10m;`,
    `${INDENT}ssl_session_timeout 10m;`,
  ].join('\n');
}

function buildLocationBlocks(domain: Domain, routes: Route[], apps: App[], hasSsl: boolean): string {
  const sorted = [...routes].sort((a, b) => b.path.length - a.path.length);

  return sorted.map((route) => {
    const app = apps.find((a) => a.name === route.appName);
    if (!app) {
      throw new Error(`App "${route.appName}" not found for route "${route.path}" on domain "${domain.name}"`);
    }

    const locationPath = route.path === '' ? '/' : '/' + route.path;
    const lines = [
      `${INDENT}location ${locationPath} {`,
      `${INDENT}${INDENT}proxy_pass http://${PROXY_TARGET_HOST}:${app.port};`,
      ...PROXY_SET_HEADERS.map(([n, v]) => `${INDENT}${INDENT}proxy_set_header ${n} ${v};`),
    ];

    if (app.projectType === 'nextjs') {
      lines.push(
        `${INDENT}${INDENT}proxy_http_version 1.1;`,
        `${INDENT}${INDENT}proxy_set_header Upgrade $http_upgrade;`,
        `${INDENT}${INDENT}proxy_set_header Connection "upgrade";`,
        `${INDENT}${INDENT}proxy_buffering off;`
      );
    } else if (app.projectType === 'nestjs') {
      lines.push(`${INDENT}${INDENT}proxy_http_version 1.1;`);
    }

    for (const [key, value] of Object.entries(mergeHeaders(domain, route, hasSsl))) {
      lines.push(`${INDENT}${INDENT}add_header ${key} "${value}" always;`);
    }

    lines.push(`${INDENT}}`);
    return lines.join('\n');
  }).join('\n\n');
}

function buildServerBlocks(
  domain: Domain,
  locationBlocks: string,
  hasSsl: boolean,
  wwwIsRegisteredDomain: boolean,
  certPath?: string,
  keyPath?: string
): string {
  const { name: domainName } = domain;
  const apex = isApex(domainName);

  if (!hasSsl) {
    const serverName = apex && !wwwIsRegisteredDomain
      ? `${domainName} www.${domainName}`
      : domainName;

    return [
      'server {',
      `${INDENT}listen 80;`,
      `${INDENT}server_name ${serverName};`,
      '',
      COMMON_DIRECTIVES,
      '',
      locationBlocks,
      '}',
    ].join('\n');
  }

  // Paths relative to the domain's nginx.conf dir — no absolute paths in the output.
  const domainDir = path.join(DOMAINS_DIR, domain.name);
  const relCert = path.relative(domainDir, certPath!);
  const relKey  = path.relative(domainDir, keyPath!);

  if (apex && !wwwIsRegisteredDomain) {
    // Three blocks: http redirect, www→apex SSL redirect, apex SSL content
    return [
      [
        'server {',
        `${INDENT}listen 80;`,
        `${INDENT}server_name ${domainName} www.${domainName};`,
        `${INDENT}return 301 https://$host$request_uri;`,
        '}',
      ].join('\n'),
      [
        'server {',
        `${INDENT}listen 443 ssl;`,
        `${INDENT}server_name www.${domainName};`,
        '',
        sslDirectives(relCert, relKey),
        '',
        `${INDENT}return 301 https://${domainName}$request_uri;`,
        '}',
      ].join('\n'),
      [
        'server {',
        `${INDENT}listen 443 ssl;`,
        `${INDENT}server_name ${domainName};`,
        '',
        sslDirectives(relCert, relKey),
        '',
        COMMON_DIRECTIVES,
        '',
        locationBlocks,
        '}',
      ].join('\n'),
    ].join('\n\n');
  }

  // Two blocks: http redirect + SSL content
  return [
    [
      'server {',
      `${INDENT}listen 80;`,
      `${INDENT}server_name ${domainName};`,
      `${INDENT}return 301 https://$host$request_uri;`,
      '}',
    ].join('\n'),
    [
      'server {',
      `${INDENT}listen 443 ssl;`,
      `${INDENT}server_name ${domainName};`,
      '',
      sslDirectives(relCert, relKey),
      '',
      COMMON_DIRECTIVES,
      '',
      locationBlocks,
      '}',
    ].join('\n'),
  ].join('\n\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Compiles a complete Nginx server block configuration for a domain.
 * Pure function — no DB access. fs.existsSync is called for cert path validation.
 *
 * @throws if a required App is missing, cert files are absent, or SSL mode is unsupported
 */
export function compileDomainConfig(
  domain: Domain,
  routes: Route[],
  apps: App[],
  allDomains: Domain[]
): string {
  const wwwIsRegisteredDomain = allDomains.some((d) => d.name === 'www.' + domain.name);
  const { hasSsl, certPath, keyPath } = evaluateHasSsl(domain);
  const locationBlocks = buildLocationBlocks(domain, routes, apps, hasSsl);
  const config = buildServerBlocks(domain, locationBlocks, hasSsl, wwwIsRegisteredDomain, certPath, keyPath);
  return config.endsWith('\n') ? config : config + '\n';
}

export interface NginxConfigResult {
  config: string;
  domainName: string;
  wwwSanWarning?: string;
  wwwConflictInfo?: string;
}

/**
 * Loads domain/route/app data from the DB, compiles the nginx config, and
 * returns the result with any www SAN / conflict warnings pre-computed.
 *
 * Used by both `domainCompile` and `domainShowConfig`.
 * @throws if the domain is not found or compilation fails.
 */
export function resolveNginxConfig(name: string): NginxConfigResult {
  const domainName = normalizeDomainName(name);
  const domain = DomainRepo.findByName(domainName);
  const routes = RouteRepo.getAll().filter((r) => r.domainId === domain.id);
  const apps = AppRepo.getAll();
  const allDomains = DomainRepo.getAll();

  const config = compileDomainConfig(domain, routes, apps, allDomains);
  const wwwHost = 'www.' + domainName;

  let wwwSanWarning: string | undefined;
  if (isApex(domainName) && domain.ssl.sanDomains) {
    const covered = domain.ssl.sanDomains.some(
      (san) => san.toLowerCase() === wwwHost.toLowerCase() || wildcardCoversWww(san, domainName)
    );
    if (!covered) {
      wwwSanWarning =
        `Certificate does not cover ${wwwHost} — the www HTTPS redirect block will fail ` +
        `TLS handshakes for that hostname until the certificate is reissued with this SAN included`;
    }
  }

  const wwwConflictInfo = allDomains.some((d) => d.name === wwwHost)
    ? `Skipping auto www redirect for ${domainName} — ${wwwHost} is already a registered domain with its own configuration`
    : undefined;

  return { config, domainName, wwwSanWarning, wwwConflictInfo };
}
