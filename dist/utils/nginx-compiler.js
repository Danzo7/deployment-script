import fs from "node:fs";
import { PROXY_TARGET_HOST } from "../constants.js";
import { PROXY_SET_HEADERS, mergeHeaders } from "./header-merge.js";
import { normalizeDomainName } from "./route-validation.js";
import { DomainRepo } from "../db/repos.js";
import { getHandler } from "../app-types/index.js";
const DM_LOG_FORMAT_NAME = "dm_json";
function compileDmLogFormatSnippet() {
  return `log_format ${DM_LOG_FORMAT_NAME} '{"ts":"$time_iso8601","method":"$request_method","uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,"rt":$request_time,"addr":"$remote_addr"}';
`;
}
const DM_LOG_FORMAT_SNIPPET_PATH = "/etc/nginx/conf.d/dm_log_format.conf";
function toPosixPath(p) {
  return p.replace(/\\/g, "/");
}
function isApex(domainName) {
  return domainName.split(".").length === 2;
}
function evaluateHasSsl(domain) {
  const { mode, certPath, keyPath } = domain.ssl;
  if (mode === "letsencrypt") {
    throw new Error(`Let's Encrypt mode is not yet supported by the compiler`);
  }
  if (mode !== "custom") return { hasSsl: false };
  if (!certPath || !fs.existsSync(certPath)) {
    throw new Error(
      `SSL certificate file missing for domain "${domain.name}": ${certPath ?? ""}`
    );
  }
  if (!keyPath || !fs.existsSync(keyPath)) {
    throw new Error(
      `SSL key file missing for domain "${domain.name}": ${keyPath ?? ""}`
    );
  }
  return {
    hasSsl: true,
    certPath: toPosixPath(certPath),
    keyPath: toPosixPath(keyPath)
  };
}
function wildcardCoversWww(san, parent) {
  return san.startsWith("*.") && san.slice(2).toLowerCase() === parent.toLowerCase();
}
const INDENT = "    ";
const COMMON_DIRECTIVES = [
  `${INDENT}server_tokens off;`,
  `${INDENT}client_max_body_size 20m;`,
  `${INDENT}gzip on;`,
  `${INDENT}gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;`
].join("\n");
function sslDirectives(certPath, keyPath) {
  return [
    `${INDENT}ssl_certificate ${certPath};`,
    `${INDENT}ssl_certificate_key ${keyPath};`,
    `${INDENT}ssl_protocols TLSv1.2 TLSv1.3;`,
    `${INDENT}ssl_prefer_server_ciphers off;`,
    `${INDENT}ssl_session_cache shared:SSL:10m;`,
    `${INDENT}ssl_session_timeout 10m;`
  ].join("\n");
}
function buildLocationBlocks(domain, routes, hasSsl) {
  const sorted = [...routes].sort((a, b) => b.path.length - a.path.length);
  const safeDomain = domain.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return sorted.map((route) => {
    const locationPath = route.path === "" ? "/" : "/" + route.path + "/";
    const safeRoute = route.path.replace(/[^a-z0-9]/gi, "_").replace(/^_+|_+$/g, "") || "root";
    const routeLogPath = `/var/log/nginx/${safeDomain}_${safeRoute}.access.log`;
    const lines = [
      `${INDENT}location ${locationPath} {`,
      `${INDENT}${INDENT}access_log ${routeLogPath} ${DM_LOG_FORMAT_NAME};`,
      `${INDENT}${INDENT}proxy_pass http://${PROXY_TARGET_HOST}:${route.app.port}/;`,
      ...PROXY_SET_HEADERS.map(
        ([n, v]) => `${INDENT}${INDENT}proxy_set_header ${n} ${v};`
      ),
      ...getHandler(route.app.projectType).getNginxLocationDirectives().map(
        (d) => `${INDENT}${INDENT}${d};`
      )
    ];
    for (const [key, value] of Object.entries(
      mergeHeaders(domain, route, hasSsl)
    )) {
      lines.push(`${INDENT}${INDENT}add_header ${key} "${value}" always;`);
    }
    lines.push(`${INDENT}}`);
    return lines.join("\n");
  }).join("\n\n");
}
function buildServerBlocks(domain, locationBlocks, hasSsl, wwwIsRegisteredDomain, certPath, keyPath) {
  const { name: domainName } = domain;
  const apex = isApex(domainName);
  if (!hasSsl) {
    const serverName = apex && !wwwIsRegisteredDomain ? `${domainName} www.${domainName}` : domainName;
    return [
      "server {",
      `${INDENT}listen 80;`,
      `${INDENT}server_name ${serverName};`,
      "",
      COMMON_DIRECTIVES,
      "",
      locationBlocks,
      "}"
    ].join("\n");
  }
  const relCert = certPath;
  const relKey = keyPath;
  if (apex && !wwwIsRegisteredDomain) {
    return [
      [
        "server {",
        `${INDENT}listen 80;`,
        `${INDENT}server_name ${domainName} www.${domainName};`,
        `${INDENT}return 301 https://$host$request_uri;`,
        "}"
      ].join("\n"),
      [
        "server {",
        `${INDENT}listen 443 ssl;`,
        `${INDENT}server_name www.${domainName};`,
        "",
        sslDirectives(relCert, relKey),
        "",
        `${INDENT}return 301 https://${domainName}$request_uri;`,
        "}"
      ].join("\n"),
      [
        "server {",
        `${INDENT}listen 443 ssl;`,
        `${INDENT}server_name ${domainName};`,
        "",
        sslDirectives(relCert, relKey),
        "",
        COMMON_DIRECTIVES,
        "",
        locationBlocks,
        "}"
      ].join("\n")
    ].join("\n\n");
  }
  return [
    [
      "server {",
      `${INDENT}listen 80;`,
      `${INDENT}server_name ${domainName};`,
      `${INDENT}return 301 https://$host$request_uri;`,
      "}"
    ].join("\n"),
    [
      "server {",
      `${INDENT}listen 443 ssl;`,
      `${INDENT}server_name ${domainName};`,
      "",
      sslDirectives(relCert, relKey),
      "",
      COMMON_DIRECTIVES,
      "",
      locationBlocks,
      "}"
    ].join("\n")
  ].join("\n\n");
}
function compileDomainConfig(domain, routes, allDomains) {
  const wwwIsRegisteredDomain = allDomains.some(
    (d) => d.name === "www." + domain.name
  );
  const { hasSsl, certPath, keyPath } = evaluateHasSsl(domain);
  const locationBlocks = buildLocationBlocks(domain, routes, hasSsl);
  const config = buildServerBlocks(
    domain,
    locationBlocks,
    hasSsl,
    wwwIsRegisteredDomain,
    certPath,
    keyPath
  );
  return config.endsWith("\n") ? config : config + "\n";
}
async function resolveNginxConfig(name) {
  const domainName = normalizeDomainName(name);
  const domain = await DomainRepo.findByNameWithRoutes(domainName);
  const allDomains = await DomainRepo.getAll();
  const config = compileDomainConfig(domain, domain.routes, allDomains);
  const wwwHost = "www." + domainName;
  let wwwSanWarning;
  if (isApex(domainName) && domain.ssl.sanDomains) {
    const covered = domain.ssl.sanDomains.some(
      (san) => san.toLowerCase() === wwwHost.toLowerCase() || wildcardCoversWww(san, domainName)
    );
    if (!covered) {
      wwwSanWarning = `Certificate does not cover ${wwwHost} \u2014 the www HTTPS redirect block will fail TLS handshakes for that hostname until the certificate is reissued with this SAN included`;
    }
  }
  const wwwConflictInfo = allDomains.some((d) => d.name === wwwHost) ? `Skipping auto www redirect for ${domainName} \u2014 ${wwwHost} is already a registered domain with its own configuration` : void 0;
  return { config, domainName, wwwSanWarning, wwwConflictInfo };
}
export {
  DM_LOG_FORMAT_NAME,
  DM_LOG_FORMAT_SNIPPET_PATH,
  compileDmLogFormatSnippet,
  compileDomainConfig,
  resolveNginxConfig
};
