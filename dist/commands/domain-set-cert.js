import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  checkOpenssl,
  extractPfx,
  validateCertAndKey,
  certCoversHostname,
  parseCertMetadata,
  writeCertFiles,
  buildSSLConfig
} from "../utils/ssl-helper.js";
import { DomainRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import { getCurrentUser } from "../utils/user-context.js";
async function domainSetCert(name, opts) {
  const normalized = name.toLowerCase().trim();
  const domain = await DomainRepo.findByName(normalized);
  if (!domain) {
    throw new Error(`Domain "${normalized}" not found`);
  }
  if (domain.ssl.mode === "letsencrypt") {
    throw new Error(
      "Let's Encrypt mode is not yet supported. Set ssl mode to 'custom' first."
    );
  }
  if (opts.cert !== void 0 || opts.key !== void 0) {
    await _pemPath(normalized, domain, opts);
  } else if (opts.pfx !== void 0) {
    await _pfxPath(normalized, domain, opts);
  } else {
    throw new Error("Provide --cert and --key, or --pfx and --password.");
  }
}
async function _pemPath(normalized, domain, opts) {
  const certFilePath = opts.cert;
  const keyFilePath = opts.key;
  if (!fs.existsSync(certFilePath)) {
    throw new Error(`Certificate file not found: ${certFilePath}`);
  }
  if (!fs.existsSync(keyFilePath)) {
    throw new Error(`Key file not found: ${keyFilePath}`);
  }
  const certPem = fs.readFileSync(certFilePath, "utf8");
  const keyPem = fs.readFileSync(keyFilePath, "utf8");
  validateCertAndKey(certPem, keyPem);
  const covers = certCoversHostname(certPem, normalized);
  if (!covers) {
    const meta = parseCertMetadata(certPem);
    const sanList = meta.sanDomains.length > 0 ? meta.sanDomains.join(", ") : meta.issuedTo;
    if (!opts.force) {
      throw new Error(
        `Certificate does not cover "${normalized}". Certificate covers: ${sanList}.
Use --force to attach anyway.`
      );
    }
    Logger.warn(
      `Certificate does not cover "${normalized}". Certificate covers: ${sanList}. Attaching anyway (--force).`
    );
  }
  if (domain.ssl.certPath) {
    Logger.warn(
      `Replacing existing certificate for "${normalized}" (previously expires: ${domain.ssl.expiresAt ?? "unknown"}).`
    );
  }
  const { certPath, keyPath } = writeCertFiles({
    domainName: normalized,
    certPem,
    keyPem
  });
  const metadata = parseCertMetadata(certPem);
  await DomainRepo.update(
    normalized,
    buildSSLConfig({
      certPath,
      keyPath,
      metadata
    }),
    getCurrentUser()
  );
  Logger.success(
    `Certificate attached to "${normalized}". Expires: ${metadata.expiresAt}.`
  );
}
async function _pfxPath(normalized, domain, opts) {
  checkOpenssl();
  const pfxFilePath = opts.pfx;
  if (!fs.existsSync(pfxFilePath)) {
    throw new Error(`PFX file not found: ${pfxFilePath}`);
  }
  const tmpCertPath = path.join(os.tmpdir(), `dm-pfx-cert-${Date.now()}.pem`);
  const tmpKeyPath = path.join(os.tmpdir(), `dm-pfx-key-${Date.now()}.pem`);
  let certPem;
  let keyPem;
  try {
    extractPfx({
      pfxPath: pfxFilePath,
      password: opts.password ?? "",
      tmpCertPath,
      tmpKeyPath
    });
    certPem = fs.readFileSync(tmpCertPath, "utf8");
    keyPem = fs.readFileSync(tmpKeyPath, "utf8");
  } finally {
    fs.rmSync(tmpCertPath, { force: true });
    fs.rmSync(tmpKeyPath, { force: true });
  }
  validateCertAndKey(certPem, keyPem);
  const covers = certCoversHostname(certPem, normalized);
  if (!covers) {
    const meta = parseCertMetadata(certPem);
    const sanList = meta.sanDomains.length > 0 ? meta.sanDomains.join(", ") : meta.issuedTo;
    if (!opts.force) {
      throw new Error(
        `Certificate does not cover "${normalized}". Certificate covers: ${sanList}.
Use --force to attach anyway.`
      );
    }
    Logger.warn(
      `Certificate does not cover "${normalized}". Certificate covers: ${sanList}. Attaching anyway (--force).`
    );
  }
  if (domain.ssl.certPath) {
    Logger.warn(
      `Replacing existing certificate for "${normalized}" (previously expires: ${domain.ssl.expiresAt ?? "unknown"}).`
    );
  }
  const { certPath, keyPath } = writeCertFiles({
    domainName: normalized,
    certPem,
    keyPem
  });
  const metadata = parseCertMetadata(certPem);
  await DomainRepo.update(
    normalized,
    buildSSLConfig({
      certPath,
      keyPath,
      metadata
    }),
    getCurrentUser()
  );
  Logger.success(
    `Certificate attached to "${normalized}". Expires: ${metadata.expiresAt}.`
  );
}
export {
  domainSetCert
};
