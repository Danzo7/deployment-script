import fs from "fs";
import { createHash } from "crypto";
import ssh2 from "ssh2";
const { utils: sshUtils } = ssh2;
import {
  REMOTE_DIR,
  REMOTE_AUTHORIZED_KEYS_PATH,
  REMOTE_LOGIN_ATTEMPTS_PATH,
  REMOTE_AUDIT_LOG_PATH
} from "../constants.js";
function ensureRemoteDir() {
  if (!fs.existsSync(REMOTE_DIR)) {
    fs.mkdirSync(REMOTE_DIR, { recursive: true, mode: 448 });
  }
}
function parseAuthorizedKeysFile() {
  if (!fs.existsSync(REMOTE_AUTHORIZED_KEYS_PATH)) return [];
  const lines = fs.readFileSync(REMOTE_AUTHORIZED_KEYS_PATH, "utf8").split("\n");
  const keys = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parsed = sshUtils.parseKey(line);
    if (parsed instanceof Error || Array.isArray(parsed)) continue;
    const fp = computeFingerprint(parsed.getPublicSSH());
    keys.push({
      raw: line,
      parsed,
      fingerprint: fp,
      comment: line.split(" ")[2] ?? ""
    });
  }
  return keys;
}
function computeFingerprint(publicSSH) {
  return "SHA256:" + createHash("sha256").update(publicSSH).digest("base64").replace(/=+$/, "");
}
function listAuthorizedKeys() {
  return parseAuthorizedKeysFile();
}
const ALLOWED_KEY_TYPES = /* @__PURE__ */ new Set([
  "ssh-ed25519",
  "sk-ssh-ed25519@openssh.com",
  // FIDO2 ed25519 (e.g. YubiKey)
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ecdsa-sha2-nistp256@openssh.com",
  // FIDO2 ECDSA (e.g. YubiKey)
  "ssh-rsa"
  // length validated separately below
]);
const RSA_MIN_BITS = 4096;
function addAuthorizedKey(keyOrPath, username) {
  ensureRemoteDir();
  const raw = fs.existsSync(keyOrPath) ? fs.readFileSync(keyOrPath, "utf8").trim() : keyOrPath.trim();
  const parsed = sshUtils.parseKey(raw);
  if (parsed instanceof Error || Array.isArray(parsed)) {
    throw new Error(
      "Invalid SSH public key. Expected format: ssh-ed25519 AAAA... [comment]"
    );
  }
  const keyType = parsed.type;
  if (!ALLOWED_KEY_TYPES.has(keyType)) {
    throw new Error(
      `Key type "${keyType}" is not allowed. Use one of: ed25519, sk-ssh-ed25519 (FIDO2), ecdsa-sha2-nistp256/384/521, sk-ecdsa-sha2-nistp256 (FIDO2), or RSA \u2265 4096 bits`
    );
  }
  if (keyType === "ssh-rsa") {
    let bitLength = 0;
    try {
      const buf = parsed.getPublicSSH();
      let offset = 0;
      const readUint32 = () => {
        const v = buf.readUInt32BE(offset);
        offset += 4;
        return v;
      };
      const typeLen = readUint32();
      offset += typeLen;
      const expLen = readUint32();
      offset += expLen;
      const modLen = readUint32();
      const modulus = buf.slice(offset, offset + modLen);
      const effectiveStart = modulus[0] === 0 ? 1 : 0;
      const effectiveLen = modLen - effectiveStart;
      const firstByte = modulus[effectiveStart];
      bitLength = effectiveLen * 8 - (firstByte === 0 ? 8 : Math.clz32(firstByte) - 24);
    } catch {
      throw new Error(
        "Could not determine RSA key size. Provide an ed25519 or ECDSA key instead."
      );
    }
    if (bitLength < RSA_MIN_BITS) {
      throw new Error(
        `RSA key is ${bitLength} bits. Minimum accepted size is ${RSA_MIN_BITS} bits. Use an ed25519 key for best security.`
      );
    }
  }
  const fp = computeFingerprint(parsed.getPublicSSH());
  const existing = parseAuthorizedKeysFile();
  if (existing.some((k) => k.fingerprint === fp)) {
    throw new Error(`Key already authorized (${fp})`);
  }
  const parts = raw.split(" ");
  const comment = username?.trim() || parts[2] || "";
  if (comment && existing.some((k) => k.comment === comment)) {
    throw new Error(
      `Username "${comment}" is already in use. Choose a different name.`
    );
  }
  const line = `${parts[0]} ${parts[1]}${comment ? " " + comment : ""}`;
  fs.appendFileSync(REMOTE_AUTHORIZED_KEYS_PATH, line + "\n", { mode: 384 });
  return { raw: line, parsed, fingerprint: fp, comment };
}
function removeAuthorizedKey(fingerprint) {
  const existing = parseAuthorizedKeysFile();
  const remaining = existing.filter((k) => k.fingerprint !== fingerprint);
  if (remaining.length === existing.length) return false;
  const content = remaining.map((k) => k.raw).join("\n") + (remaining.length ? "\n" : "");
  fs.writeFileSync(REMOTE_AUTHORIZED_KEYS_PATH, content, { mode: 384 });
  return true;
}
function removeAuthorizedKeyByUsername(username) {
  const existing = parseAuthorizedKeysFile();
  const remaining = existing.filter((k) => k.comment !== username);
  if (remaining.length === existing.length) return false;
  const content = remaining.map((k) => k.raw).join("\n") + (remaining.length ? "\n" : "");
  fs.writeFileSync(REMOTE_AUTHORIZED_KEYS_PATH, content, { mode: 384 });
  return true;
}
function findAuthorizedKeyByPublicSSH(publicSSH) {
  const offeredFp = computeFingerprint(publicSSH);
  return parseAuthorizedKeysFile().find((k) => k.fingerprint === offeredFp);
}
function readAttempts() {
  if (!fs.existsSync(REMOTE_LOGIN_ATTEMPTS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REMOTE_LOGIN_ATTEMPTS_PATH, "utf8"));
  } catch {
    return {};
  }
}
function writeAttempts(data) {
  ensureRemoteDir();
  fs.writeFileSync(REMOTE_LOGIN_ATTEMPTS_PATH, JSON.stringify(data), {
    mode: 384
  });
}
function isLockedOut(ip) {
  const rec = readAttempts()[ip];
  if (!rec) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}
function recordFailedAttempt(ip) {
  const data = readAttempts();
  const rec = data[ip] ?? { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  const backoffMs = Math.min(Math.pow(2, rec.fails) * 1e3, 6e5);
  rec.lockedUntil = Date.now() + backoffMs;
  data[ip] = rec;
  writeAttempts(data);
}
function clearAttempts(ip) {
  const data = readAttempts();
  delete data[ip];
  writeAttempts(data);
}
function auditLog(event) {
  ensureRemoteDir();
  const line = JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...event });
  fs.appendFileSync(REMOTE_AUDIT_LOG_PATH, line + "\n", { mode: 384 });
}
export {
  addAuthorizedKey,
  auditLog,
  clearAttempts,
  ensureRemoteDir,
  findAuthorizedKeyByPublicSSH,
  isLockedOut,
  listAuthorizedKeys,
  recordFailedAttempt,
  removeAuthorizedKey,
  removeAuthorizedKeyByUsername
};
