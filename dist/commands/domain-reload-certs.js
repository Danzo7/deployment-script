import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { DomainRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import {
  getCertStorePath,
  loadCertFromStore,
  buildSSLConfig
} from "../utils/ssl-helper.js";
async function domainReloadCerts(name) {
  if (name) {
    const normalized = name.toLowerCase().trim();
    const domain = await DomainRepo.findByName(normalized);
    if (!domain) {
      throw new Error(`Domain "${normalized}" not found`);
    }
    await reloadDomainCert(normalized);
  } else {
    const domains = await DomainRepo.getAll();
    if (domains.length === 0) {
      Logger.info("No domains found.");
      return;
    }
    Logger.nl();
    Logger.info(`Reloading certificates for ${domains.length} domain(s)...`);
    Logger.nl();
    let updated = 0;
    let added = 0;
    let removed = 0;
    let skipped = 0;
    for (const domain of domains) {
      const result = await reloadDomainCert(domain.name, true);
      if (result === "updated") updated++;
      else if (result === "added") added++;
      else if (result === "removed") removed++;
      else skipped++;
    }
    Logger.nl();
    Logger.success(`Certificate reload complete.`);
    Logger.print(
      chalk.gray(
        `  Added: ${added}, Updated: ${updated}, Removed: ${removed}, Skipped: ${skipped}`
      )
    );
    Logger.nl();
  }
}
async function reloadDomainCert(domainName, quiet = false) {
  const domain = await DomainRepo.findByName(domainName);
  if (!domain) {
    throw new Error(`Domain "${domainName}" not found`);
  }
  const certStoreDir = getCertStorePath(domainName);
  const certPath = path.join(certStoreDir, "cert.pem");
  const keyPath = path.join(certStoreDir, "key.pem");
  const certExists = fs.existsSync(certPath);
  const keyExists = fs.existsSync(keyPath);
  const dbHasCert = domain.ssl.mode === "custom" && domain.ssl.certPath;
  if (certExists && keyExists) {
    try {
      const { certPath: certPath2, keyPath: keyPath2, metadata } = loadCertFromStore(domainName);
      await DomainRepo.update(
        domainName,
        buildSSLConfig({
          certPath: certPath2,
          keyPath: keyPath2,
          uploadedAt: dbHasCert ? domain.ssl.uploadedAt : void 0,
          metadata
        })
      );
      DomainRepo.update(
        domainName,
        buildSSLConfig({
          certPath: certPath2,
          keyPath: keyPath2,
          uploadedAt: dbHasCert ? domain.ssl.uploadedAt : void 0,
          metadata
        })
      );
      if (!quiet) {
        if (dbHasCert) {
          Logger.success(
            `Certificate refreshed for "${domainName}". Expires: ${metadata.expiresAt}`
          );
        } else {
          Logger.success(
            `Certificate loaded for "${domainName}". Expires: ${metadata.expiresAt}`
          );
        }
      }
      return dbHasCert ? "updated" : "added";
    } catch (err) {
      if (!quiet) {
        Logger.error(
          `Failed to load certificate for "${domainName}": ${err.message}`
        );
      }
      return "skipped";
    }
  }
  if (dbHasCert && (!certExists || !keyExists)) {
    const missing = [];
    if (!certExists) missing.push("cert.pem");
    if (!keyExists) missing.push("key.pem");
    Logger.warn(
      `Certificate files missing for "${domainName}": ${missing.join(", ")}. Removing SSL configuration from database.`
    );
    await DomainRepo.update(domainName, { ssl: { mode: "none" } });
    return "removed";
  }
  if (!quiet && !dbHasCert) {
    if (domainName) {
      Logger.info(`No certificate configured for "${domainName}".`);
    }
  }
  return "skipped";
}
export {
  domainReloadCerts
};
