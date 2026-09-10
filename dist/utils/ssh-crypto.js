// ─── Pure Node.js SSH crypto helpers ─────────────────────────────────────────
//
// Replaces all usage of ssh2's `utils` (parseKey / generateKeyPairSync) with
// Node's built-in `crypto` module so there are no ESM named-export issues.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, generateKeyPairSync as cryptoGenKeyPair } from 'crypto';
// ── SSH wire-format helpers ───────────────────────────────────────────────────
/** Encode a Buffer as a 4-byte-length-prefixed SSH string. */
function sshString(buf) {
    const out = Buffer.allocUnsafe(4 + buf.length);
    out.writeUInt32BE(buf.length, 0);
    buf.copy(out, 4);
    return out;
}
/**
 * Convert a Node.js SPKI DER public key buffer (44 bytes for ed25519)
 * to SSH wire format: length-prefixed "ssh-ed25519" + length-prefixed raw key.
 */
export function spkiDerToSshWire(der) {
    // ed25519 SPKI DER: 12-byte header + 32-byte raw key
    if (der.length !== 44) {
        throw new Error(`Unexpected SPKI DER length ${der.length} (expected 44 for ed25519)`);
    }
    const rawPub = der.slice(12);
    return Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(rawPub)]);
}
/** SHA256 fingerprint in the format ssh-keygen -lf produces. */
export function fingerprintSshWire(wire) {
    return 'SHA256:' + createHash('sha256').update(wire).digest('base64').replace(/=+$/, '');
}
/**
 * Parse a single OpenSSH public key line (authorized_keys format).
 * Returns null if the line is blank, a comment, or malformed.
 * Only ed25519, ecdsa-sha2-nistp*, and ssh-rsa keys are handled.
 */
export function parseOpenSshPublicKey(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#'))
        return null;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2)
        return null;
    const [type, b64, comment = ''] = parts;
    let keyData;
    try {
        keyData = Buffer.from(b64, 'base64');
    }
    catch {
        return null;
    }
    // Verify the embedded type tag matches the leading token
    try {
        const tagLen = keyData.readUInt32BE(0);
        const tag = keyData.slice(4, 4 + tagLen).toString('ascii');
        if (tag !== type)
            return null;
    }
    catch {
        return null;
    }
    return { type, wire: keyData, comment, raw: trimmed };
}
/** SHA256 fingerprint from a ParsedSshPublicKey. */
export function fingerprintKey(key) {
    return fingerprintSshWire(key.wire);
}
/** Generate an ed25519 key pair using Node crypto. */
export function generateEd25519KeyPair() {
    const { privateKey: privPem, publicKey: pubDer } = cryptoGenKeyPair('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'der' },
    });
    const wire = spkiDerToSshWire(pubDer);
    const publicKey = `ssh-ed25519 ${wire.toString('base64')}`;
    return { privateKey: privPem, publicKey };
}
