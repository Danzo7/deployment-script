import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { X509Certificate, createPrivateKey, createPublicKey } from "crypto";
import { DOMAINS_DIR } from "../constants.js";
import { toISO } from "./date-helper.js";
const CERT_EXPIRY_WARNING_DAYS = 30;
function checkOpenssl() {
  try {
    execSync("openssl version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "openssl is not installed or not on your PATH. Install it and re-run."
    );
  }
}
function extractPfx(opts) {
  const { pfxPath, password, tmpCertPath, tmpKeyPath } = opts;
  const passTmpFile = path.join(os.tmpdir(), `dm-pfx-pass-${Date.now()}`);
  fs.writeFileSync(passTmpFile, password, { mode: 384 });
  try {
    const baseCmd = `openssl pkcs12 -in "${pfxPath}" -passin "file:${passTmpFile}"`;
    const runExtract = (providerFlags) => {
      execSync(
        `${baseCmd} -nokeys -clcerts -out "${tmpCertPath}"${providerFlags}`,
        { stdio: "pipe" }
      );
      execSync(
        `${baseCmd} -nocerts -nodes -out "${tmpKeyPath}"${providerFlags}`,
        { stdio: "pipe" }
      );
    };
    try {
      runExtract("");
    } catch (firstErr) {
      const stderr = firstErr.stderr?.toString() ?? "";
      if (stderr.includes("Mac verify error") || stderr.includes("mac verify failure") || stderr.includes("invalid password")) {
        throw new Error("Invalid PFX password");
      }
      runExtract(" -provider default -provider legacy");
    }
  } catch (err) {
    if (err.message === "Invalid PFX password") throw err;
    throw new Error(
      `PFX extraction failed: ${err.stderr?.toString() ?? err.message}`
    );
  } finally {
    fs.rmSync(passTmpFile, { force: true });
  }
}
function parseCertMetadata(certPem) {
  const cert = new X509Certificate(certPem);
  const expiresAt = toISO(cert.validTo);
  const issuedTo = cert.subject.split("\n").find((l) => l.startsWith("CN="))?.slice(3) ?? "";
  const issuer = cert.issuer.split("\n").find((l) => l.startsWith("CN="))?.slice(3) ?? "";
  const sanDomains = cert.subjectAltName ? cert.subjectAltName.split(", ").filter((s) => s.startsWith("DNS:")).map((s) => s.slice(4)) : [];
  return { expiresAt, issuedTo, issuer, sanDomains };
}
function validateCert(certPem) {
  let cert;
  try {
    cert = new X509Certificate(certPem);
  } catch (err) {
    throw new Error(`Invalid certificate: ${err.message}`);
  }
  if (new Date(cert.validTo) < /* @__PURE__ */ new Date()) {
    throw new Error(`Certificate expired on ${cert.validTo}`);
  }
}
function validateKey(keyPem) {
  try {
    createPrivateKey(keyPem);
  } catch (err) {
    throw new Error(`Invalid private key: ${err.message}`);
  }
}
function validateKeyMatchesCert(certPem, keyPem) {
  const cert = new X509Certificate(certPem);
  const certPubKey = cert.publicKey.export({
    type: "spki",
    format: "pem"
  });
  const privKey = createPrivateKey(keyPem);
  const derivedPubKey = createPublicKey(privKey).export({
    type: "spki",
    format: "pem"
  });
  if (certPubKey !== derivedPubKey) {
    throw new Error("Private key does not match the certificate's public key.");
  }
}
function certCoversHostname(certPem, hostname) {
  const cert = new X509Certificate(certPem);
  const lower = hostname.toLowerCase();
  const sans = cert.subjectAltName ? cert.subjectAltName.split(", ").filter((s) => s.startsWith("DNS:")).map((s) => s.slice(4).toLowerCase()) : [];
  if (sans.length > 0) {
    for (const san of sans) {
      if (san === lower) return true;
      if (san.startsWith("*.")) {
        const parent = san.slice(2);
        const hostLabels = lower.split(".");
        const parentLabels = parent.split(".");
        if (hostLabels.length === parentLabels.length + 1 && lower.endsWith("." + parent)) {
          return true;
        }
      }
    }
    return false;
  }
  const cn = cert.subject.split("\n").find((l) => l.startsWith("CN="))?.slice(3).toLowerCase();
  return cn === lower;
}
function getCertStorePath(domainName) {
  return path.join(DOMAINS_DIR, domainName, "ssl");
}
function writeCertFiles(opts) {
  const { domainName, certPem, keyPem } = opts;
  const certStoreDir = getCertStorePath(domainName);
  fs.mkdirSync(certStoreDir, { recursive: true });
  const finalCert = path.join(certStoreDir, "cert.pem");
  const finalKey = path.join(certStoreDir, "key.pem");
  const tmpCert = path.join(certStoreDir, "cert.pem.tmp");
  const tmpKey = path.join(certStoreDir, "key.pem.tmp");
  try {
    fs.writeFileSync(tmpCert, certPem, { encoding: "utf8" });
    fs.writeFileSync(tmpKey, keyPem, { encoding: "utf8" });
    fs.readFileSync(tmpCert);
    fs.readFileSync(tmpKey);
    fs.renameSync(tmpCert, finalCert);
    fs.renameSync(tmpKey, finalKey);
    fs.chmodSync(finalKey, 384);
  } finally {
    fs.rmSync(tmpCert, { force: true });
    fs.rmSync(tmpKey, { force: true });
  }
  return { certPath: finalCert, keyPath: finalKey };
}
function deleteCertFiles(domainName) {
  const certStoreDir = getCertStorePath(domainName);
  for (const filename of ["cert.pem", "key.pem"]) {
    const filePath = path.join(certStoreDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.rmSync(filePath);
      } catch (err) {
        throw new Error(`Could not delete ${filePath}: ${err.message}`);
      }
    }
  }
}
function validateCertAndKey(certPem, keyPem) {
  validateCert(certPem);
  validateKey(keyPem);
  validateKeyMatchesCert(certPem, keyPem);
}
function loadCertFromStore(domainName) {
  const certStoreDir = getCertStorePath(domainName);
  const certPath = path.join(certStoreDir, "cert.pem");
  const keyPath = path.join(certStoreDir, "key.pem");
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found: ${certPath}`);
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Key file not found: ${keyPath}`);
  }
  const certPem = fs.readFileSync(certPath, "utf8");
  const keyPem = fs.readFileSync(keyPath, "utf8");
  validateCertAndKey(certPem, keyPem);
  const metadata = parseCertMetadata(certPem);
  return { certPem, keyPem, certPath, keyPath, metadata };
}
function buildSSLConfig(opts) {
  const { certPath, keyPath, uploadedAt, metadata } = opts;
  return {
    ssl: {
      mode: "custom",
      certPath,
      keyPath,
      uploadedAt: uploadedAt ?? toISO(),
      expiresAt: metadata.expiresAt,
      issuedTo: metadata.issuedTo,
      issuer: metadata.issuer,
      sanDomains: metadata.sanDomains
    }
  };
}
export {
  CERT_EXPIRY_WARNING_DAYS,
  buildSSLConfig,
  certCoversHostname,
  checkOpenssl,
  deleteCertFiles,
  extractPfx,
  getCertStorePath,
  loadCertFromStore,
  parseCertMetadata,
  validateCert,
  validateCertAndKey,
  validateKey,
  validateKeyMatchesCert,
  writeCertFiles
};
