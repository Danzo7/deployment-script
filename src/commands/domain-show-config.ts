import { normalizeDomainName } from '../utils/route-validation.js';
import { DomainRepo, RouteRepo, AppRepo } from '../db/repos.js';
import { compileDomainConfig } from '../utils/nginx-compiler.js';
import { Logger } from '../utils/logger.js';

export async function domainShowConfig(name: string): Promise<void> {
  // 1. Normalize domain name
  const normalizedName = normalizeDomainName(name);

  // 2. Look up domain (throws if not found)
  const domain = DomainRepo.findByName(normalizedName);

  // 3. Load routes for this domain
  const routes = RouteRepo.getAll().filter((r) => r.domainId === domain.id);

  // 4. Load all apps
  const apps = AppRepo.getAll();

  // 5. Load all domains
  const allDomains = DomainRepo.getAll();

  // 6. Compile nginx config
  const configContent = compileDomainConfig(domain, routes, apps, allDomains);

  // www SAN check: apex domain with ssl.sanDomains that doesn't cover www.<domainName>
  const isApex = domain.name.split('.').length === 2;
  if (isApex && domain.ssl.sanDomains) {
    const wwwHost = 'www.' + domain.name;
    const covered = domain.ssl.sanDomains.some(
      (san) => san.toLowerCase() === wwwHost.toLowerCase()
    );
    if (!covered) {
      Logger.warn(
        `Certificate does not cover ${wwwHost} — the www HTTPS redirect block will fail TLS handshakes for that hostname until the certificate is reissued with this SAN included`
      );
    }
  }

  // www-conflict check: if www.<domainName> is already a registered domain
  const wwwDomainName = 'www.' + domain.name;
  const wwwIsRegistered = allDomains.some((d) => d.name === wwwDomainName);
  if (wwwIsRegistered) {
    Logger.info(
      `Skipping auto www redirect for ${domain.name} — ${wwwDomainName} is already a registered domain with its own configuration`
    );
  }

  // Print full config to stdout — no file write
  console.log(configContent);
}
