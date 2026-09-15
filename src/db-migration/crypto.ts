import crypto from 'crypto';
import { DB_CRED_KEY } from '../constants.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'dm-db-creds-v1'; // static salt, fine for this use case

function deriveKey(): Buffer {
  if (!DB_CRED_KEY) throw new Error('DB_CRED_KEY not set');
  return crypto.scryptSync(DB_CRED_KEY, SALT, 32);
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  
  // Format: base64(iv|tag|ciphertext)
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

export function decryptSecret(ciphertext: string): string {
  const key = deriveKey();
  const combined = Buffer.from(ciphertext, 'base64');
  
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}
