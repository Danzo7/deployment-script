import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkOpenssl,
  extractPfx,
  validateCertAndKey,
  certCoversHostname,
  parseCertMetadata,
  writeCertFiles,
  buildSSLConfig,
} from '../utils/ssl-helper.js';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export async function domainSetCert(
  name: string,
  opts: {
    cert?: string;
    key?: string;
    pfx?: string;
    password?: string;
    force?: boolean;
  }
): Promise<void> {
  // 1. Normalize domain name and look up in DB
  const normalized = name.toLowerCase().trim();
  const domain = await DomainRepo.findByName(normalized);
  if (!domain) {
    throw new Error(`Domain "${normalized}" not found`);
  }

  // 2. Guard: Let's Encrypt mode is not supported
  if (domain.ssl.mode === 'letsencrypt') {
    throw new Error(
      "Let's Encrypt mode is not yet supported. Set ssl mode to 'custom' first."
    );
  }

  if (opts.cert !== undefined || opts.key !== undefined) {
    // ---- PEM upload path ----
    await _pemPath(normalized, domain, opts);
  } else if (opts.pfx !== undefined) {
    // ---- PFX upload path ----
    await _pfxPath(normalized, domain, opts);
  } else {
    throw new Error('Provide --cert and --key, or --pfx and --password.');
  }
}

async function _pemPath(
  normalized: string,
  domain: import('../db/model.js').Domain,
  opts: { cert?: string; key?: string; force?: boolean }
): Promise<void> {
  const certFilePath = opts.cert!;
  const keyFilePath = opts.key!;

  // 3. Check both files exist
  if (!fs.existsSync(certFilePath)) {
    throw new Error(`Certificate file not found: ${certFilePath}`);
  }
  if (!fs.existsSync(keyFilePath)) {
    throw new Error(`Key file not found: ${keyFilePath}`);
  }

  // 4. Read both files
  const certPem = fs.readFileSync(certFilePath, 'utf8');
  const keyPem = fs.readFileSync(keyFilePath, 'utf8');

  // 5-7. Validate certificate, key, and match
  validateCertAndKey(certPem, keyPem);

  // 8. Check certificate covers the domain hostname
  const covers = certCoversHostname(certPem, normalized);
  if (!covers) {
    const meta = parseCertMetadata(certPem);
    const sanList =
      meta.sanDomains.length > 0 ? meta.sanDomains.join(', ') : meta.issuedTo;
    if (!opts.force) {
      throw new Error(
        `Certificate does not cover "${normalized}". Certificate covers: ${sanList}.\nUse --force to attach anyway.`
      );
    }
    Logger.warn(
      `Certificate does not cover "${normalized}". Certificate covers: ${sanList}. Attaching anyway (--force).`
    );
  }

  // 9. Warn if domain already has a cert attached
  if (domain.ssl.certPath) {
    Logger.warn(
      `Replacing existing certificate for "${normalized}" (previously expires: ${domain.ssl.expiresAt ?? 'unknown'}).`
    );
  }

  // 10. Write cert files atomically
  const { certPath, keyPath } = writeCertFiles({
    domainName: normalized,
    certPem,
    keyPem,
  });

  // 11. Parse certificate metadata
  const metadata = parseCertMetadata(certPem);

  // 12. Update domain record in DB
  await DomainRepo.update(normalized, buildSSLConfig({
    certPath,
    keyPath,
    metadata,
  }));

  // 13. Log success
  Logger.success(
    `Certificate attached to "${normalized}". Expires: ${metadata.expiresAt}.`
  );
}

async function _pfxPath(
  normalized: string,
  domain: import('../db/model.js').Domain,
  opts: { pfx?: string; password?: string; force?: boolean }
): Promise<void> {
  // 3. Check openssl is available before any file I/O
  checkOpenssl();

  const pfxFilePath = opts.pfx!;

  // 4. Check PFX file exists
  if (!fs.existsSync(pfxFilePath)) {
    throw new Error(`PFX file not found: ${pfxFilePath}`);
  }

  // 5. Create two tmp file paths for extracted PEM content
  const tmpCertPath = path.join(os.tmpdir(), `dm-pfx-cert-${Date.now()}.pem`);
  const tmpKeyPath  = path.join(os.tmpdir(), `dm-pfx-key-${Date.now()}.pem`);

  let certPem: string;
  let keyPem: string;

  try {
    // 6. Extract PEM cert and key from the PFX bundle
    extractPfx({
      pfxPath: pfxFilePath,
      password: opts.password ?? '',
      tmpCertPath,
      tmpKeyPath,
    });

    // 7. Read the extracted PEM strings
    certPem = fs.readFileSync(tmpCertPath, 'utf8');
    keyPem  = fs.readFileSync(tmpKeyPath,  'utf8');
  } finally {
    // 8. Always clean up the tmp files
    fs.rmSync(tmpCertPath, { force: true });
    fs.rmSync(tmpKeyPath,  { force: true });
  }

  // 9-11. Validate certificate, key, and match
  validateCertAndKey(certPem, keyPem);

  // 12. Check certificate covers the domain hostname
  const covers = certCoversHostname(certPem, normalized);
  if (!covers) {
    const meta = parseCertMetadata(certPem);
    const sanList =
      meta.sanDomains.length > 0 ? meta.sanDomains.join(', ') : meta.issuedTo;
    if (!opts.force) {
      throw new Error(
        `Certificate does not cover "${normalized}". Certificate covers: ${sanList}.\nUse --force to attach anyway.`
      );
    }
    Logger.warn(
      `Certificate does not cover "${normalized}". Certificate covers: ${sanList}. Attaching anyway (--force).`
    );
  }

  // 13. Warn if domain already has a cert attached
  if (domain.ssl.certPath) {
    Logger.warn(
      `Replacing existing certificate for "${normalized}" (previously expires: ${domain.ssl.expiresAt ?? 'unknown'}).`
    );
  }

  // 14. Write cert files atomically
  const { certPath, keyPath } = writeCertFiles({
    domainName: normalized,
    certPem,
    keyPem,
  });

  // 15. Parse certificate metadata
  const metadata = parseCertMetadata(certPem);

  // 16. Update domain record in DB
  await DomainRepo.update(normalized, buildSSLConfig({
    certPath,
    keyPath,
    metadata,
  }));

  // 17. Log success
  Logger.success(
    `Certificate attached to "${normalized}". Expires: ${metadata.expiresAt}.`
  );
}
