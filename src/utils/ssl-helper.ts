import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { X509Certificate, createPrivateKey, createPublicKey } from 'crypto';
import { DOMAINS_DIR } from '../constants.js';
import { toISO } from './date-helper.js';

/**
 * Number of days before certificate expiry at which a warning is shown.
 */
export const CERT_EXPIRY_WARNING_DAYS = 30;

/**
 * Checks that openssl is installed and available on the PATH.
 * Throws if not — required for PFX extraction operations.
 */
export function checkOpenssl(): void {
  try {
    execSync('openssl version', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'openssl is not installed or not on your PATH. Install it and re-run.'
    );
  }
}

/**
 * Extracts a PEM certificate and private key from a PFX/PKCS#12 bundle
 * using the system openssl binary.
 *
 * The PFX password is passed via a temporary file (never as a CLI argument)
 * to prevent it from appearing in process listings (ps aux).
 *
 * The temp file is always deleted in the finally block regardless of success
 * or failure.
 *
 * @throws Error with openssl stderr on extraction failure.
 */
export function extractPfx(opts: {
  pfxPath: string;
  password: string;
  tmpCertPath: string;
  tmpKeyPath: string;
}): void {
  const { pfxPath, password, tmpCertPath, tmpKeyPath } = opts;

  const passTmpFile = path.join(os.tmpdir(), `dm-pfx-pass-${Date.now()}`);
  fs.writeFileSync(passTmpFile, password, { mode: 0o600 });

  try {
    // Build the base command without provider flags — works for modern PFX files
    // (AES-256 encrypted, OpenSSL 3.x generated).
    const baseCmd = `openssl pkcs12 -in "${pfxPath}" -passin "file:${passTmpFile}"`;

    const runExtract = (providerFlags: string) => {
      execSync(
        `${baseCmd} -nokeys -clcerts -out "${tmpCertPath}"${providerFlags}`,
        { stdio: 'pipe' }
      );
      execSync(
        `${baseCmd} -nocerts -nodes -out "${tmpKeyPath}"${providerFlags}`,
        { stdio: 'pipe' }
      );
    };

    try {
      // First attempt: no legacy provider — works on most modern PFX files and
      // on systems where legacy.dll is not installed.
      runExtract('');
    } catch (firstErr: any) {
      const stderr: string = firstErr.stderr?.toString() ?? '';

      // If this looks like a bad password (not a provider issue), surface it
      // immediately rather than retrying with legacy — the retry would also fail
      // with the same misleading provider error on OpenSSL 3.
      if (
        stderr.includes('Mac verify error') ||
        stderr.includes('mac verify failure') ||
        stderr.includes('invalid password')
      ) {
        throw new Error('Invalid PFX password');
      }

      // Otherwise assume the PFX uses legacy encryption (RC2/3DES, OpenSSL 1.x
      // or Windows-exported). Use explicit provider flags — more reliable than
      // the -legacy shorthand on OpenSSL 3 where provider loading order matters.
      runExtract(' -provider default -provider legacy');
    }
  } catch (err: any) {
    if (err.message === 'Invalid PFX password') throw err;
    throw new Error(
      `PFX extraction failed: ${err.stderr?.toString() ?? err.message}`
    );
  } finally {
    fs.rmSync(passTmpFile, { force: true });
  }
}

/**
 * Parses metadata from a PEM certificate string using Node's built-in crypto module.
 *
 * @returns expiresAt — ISO 8601 expiry timestamp
 * @returns issuedTo  — CN from the subject field
 * @returns issuer    — CN from the issuer field
 * @returns sanDomains — list of DNS Subject Alternative Names (empty array if none)
 */
export function parseCertMetadata(certPem: string): {
  expiresAt: string;
  issuedTo: string;
  issuer: string;
  sanDomains: string[];
} {
  const cert = new X509Certificate(certPem);

  const expiresAt = toISO(cert.validTo);

  const issuedTo =
    cert.subject
      .split('\n')
      .find((l) => l.startsWith('CN='))
      ?.slice(3) ?? '';

  const issuer =
    cert.issuer
      .split('\n')
      .find((l) => l.startsWith('CN='))
      ?.slice(3) ?? '';

  const sanDomains: string[] = cert.subjectAltName
    ? cert.subjectAltName
        .split(', ')
        .filter((s) => s.startsWith('DNS:'))
        .map((s) => s.slice(4))
    : [];

  return { expiresAt, issuedTo, issuer, sanDomains };
}

/**
 * Validates that a PEM certificate is parseable by crypto.X509Certificate
 * and that it has not yet expired.
 *
 * @throws `'Invalid certificate: <message>'` if the PEM cannot be parsed.
 * @throws `'Certificate expired on <validTo>'` if the certificate is past its expiry date.
 */
export function validateCert(certPem: string): void {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch (err: any) {
    throw new Error(`Invalid certificate: ${err.message}`);
  }

  if (new Date(cert.validTo) < new Date()) {
    throw new Error(`Certificate expired on ${cert.validTo}`);
  }
}

/**
 * Validates that a PEM private key is parseable by crypto.createPrivateKey.
 *
 * @throws `'Invalid private key: <message>'` if the key cannot be parsed.
 */
export function validateKey(keyPem: string): void {
  try {
    createPrivateKey(keyPem);
  } catch (err: any) {
    throw new Error(`Invalid private key: ${err.message}`);
  }
}

/**
 * Validates that the given private key matches the certificate's public key.
 *
 * Compares SPKI-format public key exported from the certificate against the
 * public key derived from the private key. Supports both RSA and EC keys.
 *
 * @throws `"Private key does not match the certificate's public key."` on mismatch.
 */
export function validateKeyMatchesCert(certPem: string, keyPem: string): void {
  const cert = new X509Certificate(certPem);
  const certPubKey = cert.publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string;

  const privKey = createPrivateKey(keyPem);
  const derivedPubKey = createPublicKey(privKey).export({
    type: 'spki',
    format: 'pem',
  }) as string;

  if (certPubKey !== derivedPubKey) {
    throw new Error("Private key does not match the certificate's public key.");
  }
}

/**
 * Checks whether the certificate covers the given hostname.
 *
 * Matching rules (RFC 6125):
 *  - Exact SAN DNS match (case-insensitive)
 *  - Wildcard SAN: *.domain.com covers api.domain.com (exactly one label to the
 *    left of the parent) but NOT domain.com (apex) and NOT sub.api.domain.com
 *    (more than one label deep).
 *
 * If no SAN entries are present, falls back to the CN field in the subject
 * (legacy certificate support).
 *
 * @returns true if the certificate covers the hostname, false otherwise.
 */
export function certCoversHostname(certPem: string, hostname: string): boolean {
  const cert = new X509Certificate(certPem);
  const lower = hostname.toLowerCase();

  const sans: string[] = cert.subjectAltName
    ? cert.subjectAltName
        .split(', ')
        .filter((s) => s.startsWith('DNS:'))
        .map((s) => s.slice(4).toLowerCase())
    : [];

  if (sans.length > 0) {
    for (const san of sans) {
      if (san === lower) return true; // exact match

      if (san.startsWith('*.')) {
        // Wildcard: *.parent covers <single-label>.parent ONLY.
        // Does NOT cover the apex (parent itself) or deeper subdomain levels.
        const parent = san.slice(2); // e.g. "domain.com"
        const hostLabels = lower.split('.');
        const parentLabels = parent.split('.');

        if (
          hostLabels.length === parentLabels.length + 1 &&
          lower.endsWith('.' + parent)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // Fallback to CN if no SANs present (legacy certs only)
  const cn = cert.subject
    .split('\n')
    .find((l) => l.startsWith('CN='))
    ?.slice(3)
    .toLowerCase();

  return cn === lower;
}

/**
 * Returns the absolute path to the Cert_Store directory for a given domain.
 * The Cert_Store is: <DOMAINS_DIR>/<domainName>/ssl
 */
export function getCertStorePath(domainName: string): string {
  return path.join(DOMAINS_DIR, domainName, 'ssl');
}

/**
 * Atomically writes cert.pem and key.pem into the Cert_Store for the given domain.
 *
 * Strategy:
 *  1. mkdirSync the cert store directory (recursive)
 *  2. Write certPem to cert.pem.tmp
 *  3. Write keyPem to key.pem.tmp
 *  4. Validate both tmp files are readable (sanity check)
 *  5. renameSync tmp cert → final cert.pem
 *  6. renameSync tmp key  → final key.pem
 *  7. chmodSync(finalKey, 0o600) — NOT optional — security requirement:
 *     private key must not be world-readable
 *
 *  On any failure in steps 2–7 the tmp files are removed in a finally block,
 *  leaving any previously-stored certificate untouched.
 *
 * @returns Absolute paths to the written { certPath, keyPath }.
 */
export function writeCertFiles(opts: {
  domainName: string;
  certPem: string;
  keyPem: string;
}): { certPath: string; keyPath: string } {
  const { domainName, certPem, keyPem } = opts;

  const certStoreDir = getCertStorePath(domainName);
  fs.mkdirSync(certStoreDir, { recursive: true });

  const finalCert = path.join(certStoreDir, 'cert.pem');
  const finalKey = path.join(certStoreDir, 'key.pem');
  const tmpCert = path.join(certStoreDir, 'cert.pem.tmp');
  const tmpKey = path.join(certStoreDir, 'key.pem.tmp');

  try {
    fs.writeFileSync(tmpCert, certPem, { encoding: 'utf8' });
    fs.writeFileSync(tmpKey, keyPem, { encoding: 'utf8' });

    // Sanity-check: verify both tmp files are readable before committing
    fs.readFileSync(tmpCert);
    fs.readFileSync(tmpKey);

    fs.renameSync(tmpCert, finalCert);
    fs.renameSync(tmpKey, finalKey);

    // NOT optional — security requirement: private key must not be world-readable
    fs.chmodSync(finalKey, 0o600);
  } finally {
    fs.rmSync(tmpCert, { force: true });
    fs.rmSync(tmpKey, { force: true });
  }

  return { certPath: finalCert, keyPath: finalKey };
}

/**
 * Deletes cert.pem and key.pem from the Cert_Store for the given domain.
 *
 * Each file is only removed if it exists.  If a file exists but cannot be
 * deleted (e.g. permission error), an error is thrown with the message:
 *   'Could not delete <path>: <error>'
 */
export function deleteCertFiles(domainName: string): void {
  const certStoreDir = getCertStorePath(domainName);

  for (const filename of ['cert.pem', 'key.pem'] as const) {
    const filePath = path.join(certStoreDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.rmSync(filePath);
      } catch (err: any) {
        throw new Error(`Could not delete ${filePath}: ${err.message}`);
      }
    }
  }
}

/**
 * Validates a certificate and key pair.
 *
 * Performs all necessary validation:
 * - Certificate is valid PEM and not expired
 * - Key is valid PEM
 * - Key matches the certificate
 *
 * @throws Error if any validation fails
 */
export function validateCertAndKey(certPem: string, keyPem: string): void {
  validateCert(certPem);
  validateKey(keyPem);
  validateKeyMatchesCert(certPem, keyPem);
}

/**
 * Loads and validates a certificate and key from the Cert_Store for a domain.
 *
 * @returns Object with certPem, keyPem, certPath, keyPath, and parsed metadata
 * @throws Error if files don't exist or validation fails
 */
export function loadCertFromStore(domainName: string): {
  certPem: string;
  keyPem: string;
  certPath: string;
  keyPath: string;
  metadata: ReturnType<typeof parseCertMetadata>;
} {
  const certStoreDir = getCertStorePath(domainName);
  const certPath = path.join(certStoreDir, 'cert.pem');
  const keyPath = path.join(certStoreDir, 'key.pem');

  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found: ${certPath}`);
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Key file not found: ${keyPath}`);
  }

  const certPem = fs.readFileSync(certPath, 'utf8');
  const keyPem = fs.readFileSync(keyPath, 'utf8');

  validateCertAndKey(certPem, keyPem);

  const metadata = parseCertMetadata(certPem);

  return { certPem, keyPem, certPath, keyPath, metadata };
}

/**
 * Prepares SSL configuration data for database update.
 *
 * Returns the SSL configuration object that can be passed to DomainRepo.update().
 * Separated from the actual DB update to avoid circular dependencies.
 */
export function buildSSLConfig(opts: {
  certPath: string;
  keyPath: string;
  uploadedAt?: string;
  metadata: {
    expiresAt: string;
    issuedTo: string;
    issuer: string;
    sanDomains: string[];
  };
}) {
  const { certPath, keyPath, uploadedAt, metadata } = opts;

  return {
    ssl: {
      mode: 'custom' as const,
      certPath,
      keyPath,
      uploadedAt: uploadedAt ?? toISO(),
      expiresAt: metadata.expiresAt,
      issuedTo: metadata.issuedTo,
      issuer: metadata.issuer,
      sanDomains: metadata.sanDomains,
    },
  };
}
