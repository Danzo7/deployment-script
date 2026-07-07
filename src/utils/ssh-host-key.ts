// ─── SSH host key management ─────────────────────────────────────────────────
//
// Generates and persists a single ed25519 host key for the dm remote server,
// analogous to /etc/ssh/ssh_host_ed25519_key. Clients pin this key's
// fingerprint on first connect (TOFU) so a later mismatch is flagged as a
// potential MITM rather than silently accepted.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import { generateKeyPairSync, createPublicKey } from 'crypto';
import { spkiDerToSshWire, fingerprintSshWire } from './ssh-crypto.js';
import { REMOTE_HOST_KEY_PATH } from '../constants.js';
import { ensureRemoteDir } from './remote-auth.js';

/** Returns the PEM-encoded private host key, generating one on first run. */
export function loadOrCreateHostKey(): Buffer {
  ensureRemoteDir();
  if (!fs.existsSync(REMOTE_HOST_KEY_PATH)) {
    const { privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    fs.writeFileSync(REMOTE_HOST_KEY_PATH, privateKey, { mode: 0o600 });
  }
  return fs.readFileSync(REMOTE_HOST_KEY_PATH);
}

/** SHA256 fingerprint matching the format `ssh-keygen -lf` produces. */
export function fingerprintHostKey(pem: Buffer): string {
  const pubKeyObj = createPublicKey({ key: pem, format: 'pem' });
  const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
  const wire = spkiDerToSshWire(spkiDer);
  return fingerprintSshWire(wire);
}
