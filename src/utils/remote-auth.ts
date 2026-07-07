// ─── Remote access auth store ────────────────────────────────────────────────
//
// Manages authorized public keys, login throttling, and the audit log for
// `dm remote serve`. Password auth has been removed — public key only.
//
// Public keys are stored in OpenSSH authorized_keys format (one per line) so
// operators can use standard tooling.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import { createHash } from 'crypto';
import ssh2 from 'ssh2';
import type { ParsedKey } from 'ssh2';

const { utils: sshUtils } = ssh2;
import {
  REMOTE_DIR,
  REMOTE_AUTHORIZED_KEYS_PATH,
  REMOTE_LOGIN_ATTEMPTS_PATH,
  REMOTE_AUDIT_LOG_PATH,
} from '../constants.js';

// ── Directory bootstrap ──────────────────────────────────────────────────────

export function ensureRemoteDir(): void {
  if (!fs.existsSync(REMOTE_DIR)) {
    fs.mkdirSync(REMOTE_DIR, { recursive: true, mode: 0o700 });
  }
}

// ── Authorized keys ──────────────────────────────────────────────────────────

export interface AuthorizedKey {
  raw: string;
  comment: string;
  fingerprint: string;
  parsed: ParsedKey;
}

function parseAuthorizedKeysFile(): AuthorizedKey[] {
  if (!fs.existsSync(REMOTE_AUTHORIZED_KEYS_PATH)) return [];
  const lines = fs.readFileSync(REMOTE_AUTHORIZED_KEYS_PATH, 'utf8').split('\n');
  const keys: AuthorizedKey[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = sshUtils.parseKey(line);
    if (parsed instanceof Error || Array.isArray(parsed)) continue;
    const fp = computeFingerprint(parsed.getPublicSSH());
    keys.push({ raw: line, parsed, fingerprint: fp, comment: line.split(' ')[2] ?? '' });
  }
  return keys;
}

function computeFingerprint(publicSSH: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(publicSSH).digest('base64').replace(/=+$/, '');
}

export function listAuthorizedKeys(): AuthorizedKey[] {
  return parseAuthorizedKeysFile();
}

// Allowed public key algorithms — DSA and unknown types are rejected.
// RSA is accepted only at ≥ 4096 bits; shorter RSA keys are rejected.
const ALLOWED_KEY_TYPES = new Set([
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'ssh-rsa', // length validated separately below
]);

const RSA_MIN_BITS = 4096;

/** Accepts either a raw "ssh-ed25519 AAAA... comment" string or a path to a .pub file.
 *  comment the public key file already has. This username is then used as the
 *  identity in audit logs and the DM_REMOTE_USER env var for remote sessions.
 */
export function addAuthorizedKey(keyOrPath: string, username?: string): AuthorizedKey {
  ensureRemoteDir();
  const raw = fs.existsSync(keyOrPath)
    ? fs.readFileSync(keyOrPath, 'utf8').trim()
    : keyOrPath.trim();

  const parsed = sshUtils.parseKey(raw);
  if (parsed instanceof Error || Array.isArray(parsed)) {
    throw new Error('Invalid SSH public key. Expected format: ssh-ed25519 AAAA... [comment]');
  }

  // Reject weak/legacy key types (DSA, etc.)
  const keyType = (parsed as any).type as string;
  if (!ALLOWED_KEY_TYPES.has(keyType)) {
    throw new Error(
      `Key type "${keyType}" is not allowed. Use one of: ed25519, ecdsa-sha2-nistp256/384/521, or RSA ≥ 4096 bits`
    );
  }

  // For RSA keys, enforce minimum bit length.
  if (keyType === 'ssh-rsa') {
    // ssh2's ParsedKey exposes the modulus buffer at parsed.n (node-forge style).
    const modulus: Buffer | undefined = (parsed as any).n;
    if (!modulus) {
      throw new Error('Could not determine RSA key size. Provide an ed25519 or ECDSA key instead.');
    }
    // Bit length = byte length × 8, minus leading zero bits in the first byte.
    const bitLength = (modulus.length - 1) * 8 + (8 - Math.clz32(modulus[0]));
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
  const parts = raw.split(' ');
  const comment = username?.trim() || parts[2] || '';
  if (comment && existing.some((k) => k.comment === comment)) {
    throw new Error(`Username "${comment}" is already in use. Choose a different name.`);
  }

  // Build the line: always "type base64 username" so the comment is the username.
  // If no username given, keep whatever comment was in the original key.
  const line = `${parts[0]} ${parts[1]}${comment ? ' ' + comment : ''}`;

  fs.appendFileSync(REMOTE_AUTHORIZED_KEYS_PATH, line + '\n', { mode: 0o600 });
  return { raw: line, parsed, fingerprint: fp, comment };
}

export function removeAuthorizedKey(fingerprint: string): boolean {
  const existing = parseAuthorizedKeysFile();
  const remaining = existing.filter((k) => k.fingerprint !== fingerprint);
  if (remaining.length === existing.length) return false;
  const content = remaining.map((k) => k.raw).join('\n') + (remaining.length ? '\n' : '');
  fs.writeFileSync(REMOTE_AUTHORIZED_KEYS_PATH, content, { mode: 0o600 });
  return true;
}

export function removeAuthorizedKeyByUsername(username: string): boolean {
  const existing = parseAuthorizedKeysFile();
  const remaining = existing.filter((k) => k.comment !== username);
  if (remaining.length === existing.length) return false;
  const content = remaining.map((k) => k.raw).join('\n') + (remaining.length ? '\n' : '');
  fs.writeFileSync(REMOTE_AUTHORIZED_KEYS_PATH, content, { mode: 0o600 });
  return true;
}

/** Used during SSH publickey auth — matches on raw SSH wire bytes. */
export function findAuthorizedKeyByPublicSSH(publicSSH: Buffer): AuthorizedKey | undefined {
  return parseAuthorizedKeysFile().find(
    (k) => Buffer.compare(k.parsed.getPublicSSH(), publicSSH) === 0
  );
}

// ── Login throttling ─────────────────────────────────────────────────────────

interface AttemptRecord {
  fails: number;
  lockedUntil: number;
}

function readAttempts(): Record<string, AttemptRecord> {
  if (!fs.existsSync(REMOTE_LOGIN_ATTEMPTS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REMOTE_LOGIN_ATTEMPTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAttempts(data: Record<string, AttemptRecord>): void {
  ensureRemoteDir();
  fs.writeFileSync(REMOTE_LOGIN_ATTEMPTS_PATH, JSON.stringify(data), { mode: 0o600 });
}

/** Returns ms remaining in lockout, or 0 if the IP is not currently locked. */
export function isLockedOut(ip: string): number {
  const rec = readAttempts()[ip];
  if (!rec) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}

export function recordFailedAttempt(ip: string): void {
  const data = readAttempts();
  const rec = data[ip] ?? { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  // Exponential backoff: 2^fails seconds, capped at 10 minutes.
  const backoffMs = Math.min(Math.pow(2, rec.fails) * 1000, 600_000);
  rec.lockedUntil = Date.now() + backoffMs;
  data[ip] = rec;
  writeAttempts(data);
}

export function clearAttempts(ip: string): void {
  const data = readAttempts();
  delete data[ip];
  writeAttempts(data);
}

// ── Audit log ────────────────────────────────────────────────────────────────

export function auditLog(event: Record<string, unknown>): void {
  ensureRemoteDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  fs.appendFileSync(REMOTE_AUDIT_LOG_PATH, line + '\n', { mode: 0o600 });
}
