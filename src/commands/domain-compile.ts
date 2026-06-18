import * as fs from 'fs';
import * as path from 'path';
import { createTwoFilesPatch } from 'diff';
import { normalizeDomainName } from '../utils/route-validation.js';
import { DomainRepo, RouteRepo, AppRepo } from '../db/repos.js';
import { compileDomainConfig } from '../utils/nginx-compiler.js';
import { Logger } from '../utils/logger.js';
import { DOMAINS_DIR } from '../constants.js';

export async function domainCompile(name: string): Promise<void> {
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

  // 7a. www SAN check: apex domain with ssl.sanDomains that doesn't cover www.<domainName>
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

  // 7b. www-conflict check: if www.<domainName> is already a registered domain
  const wwwDomainName = 'www.' + domain.name;
  const wwwIsRegistered = allDomains.some((d) => d.name === wwwDomainName);
  if (wwwIsRegistered) {
    Logger.info(
      `Skipping auto www redirect for ${domain.name} — ${wwwDomainName} is already a registered domain with its own configuration`
    );
  }

  // 8. mkdirSync output dir
  const outputDir = path.join(DOMAINS_DIR, normalizedName);
  fs.mkdirSync(outputDir, { recursive: true });

  // 9. Output path
  const outputPath = path.join(outputDir, 'nginx.conf');

  // 10. Read previous file content if it exists
  let previousContent: string | undefined;
  try {
    previousContent = fs.readFileSync(outputPath, 'utf8');
  } catch {
    // File does not exist yet
    previousContent = undefined;
  }

  // 11 / 12. Diff or print full content
  if (previousContent !== undefined) {
    const diff = createTwoFilesPatch(
      outputPath,
      outputPath,
      previousContent,
      configContent
    );

    // Check if there are any real change hunks (lines starting with @@ indicate hunks)
    const hasChanges = diff.split('\n').some((line) => line.startsWith('@@'));

    if (!hasChanges) {
      Logger.info(`nginx.conf is unchanged for ${name}`);
    } else {
      process.stdout.write(diff);
    }
  } else {
    // No previous content — print the full new config
    process.stdout.write(configContent);
  }

  // 13. Write new config
  fs.writeFileSync(outputPath, configContent, 'utf8');

  // 14. Log success
  Logger.success(outputPath);
}
