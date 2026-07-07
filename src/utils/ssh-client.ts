// ─── dm remote client ────────────────────────────────────────────────────────
//
// `dm remote connect --host <ip> [--port <p>]` — puts the local terminal into
// raw mode and pipes it to a pty-backed dm REPL on the remote server.
// Arrow keys, tab-completion, Ctrl+C, colors, and terminal resize all work
// because the remote side is a real pty.
//
// Key bootstrap: if no ed25519 key exists in ~/.ssh, one is generated
// automatically and the public key is printed so the user can hand it to
// the server admin.
// ─────────────────────────────────────────────────────────────────────────────

import ssh2 from 'ssh2';
import type { Client as ClientType } from 'ssh2';
import fs from 'fs';

const { Client } = ssh2;
const { utils: sshUtils } = ssh2;
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { createHash } from 'crypto';
import { Logger } from './logger.js';
import { REMOTE_KNOWN_HOSTS_PATH, REMOTE_PORT } from '../constants.js';
import { ensureRemoteDir } from './remote-auth.js';

const DEFAULT_KEY_PATH = join(homedir(), '.ssh', 'id_ed25519');

// ── Client key bootstrap ──────────────────────────────────────────────────────

/**
 * Ensures a client SSH key exists. If none is found, generates an ed25519
 * key pair using ssh2 (pure Node.js — no ssh-keygen required) and prints
 * the public key for the user to hand to the server admin.
 * Returns the path to the private key to use, or undefined on failure.
 */
export function ensureClientKey(): string | undefined {
  const pubPath = DEFAULT_KEY_PATH + '.pub';

  if (fs.existsSync(DEFAULT_KEY_PATH) && fs.existsSync(pubPath)) {
    return DEFAULT_KEY_PATH;
  }

  const sshDir = join(homedir(), '.ssh');
  if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  Logger.info('No SSH key found. Generating a new ed25519 key pair…');
  const keys = (sshUtils as any).generateKeyPairSync('ed25519') as { private: string; public: string };
  fs.writeFileSync(DEFAULT_KEY_PATH, keys.private, { mode: 0o600 });
  fs.writeFileSync(pubPath, keys.public, { mode: 0o644 });

  Logger.success('SSH key generated successfully.');
  Logger.info('Share the following public key with the server admin to get authorized:');
  console.log('');
  console.log(chalk.cyan(keys.public.trim()));
  console.log('');
  Logger.info('Once authorized, run this command again to connect.');
  return undefined;
}

// ── Target parsing ───────────────────────────────────────────────────────────

/** Accepts plain host/IP with optional port. No user@ prefix needed. */
function parseTarget(host: string, port?: number): { host: string; port: number } {
  // Strip any accidental user@ prefix for backwards compat
  const cleanHost = host.includes('@') ? host.slice(host.indexOf('@') + 1) : host;
  // Strip port if it was embedded as host:port
  const ipv6Match = cleanHost.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6Match) {
    return { host: ipv6Match[1], port: port ?? (ipv6Match[2] ? Number(ipv6Match[2]) : REMOTE_PORT) };
  }
  const lastColon = cleanHost.lastIndexOf(':');
  if (lastColon !== -1 && !port) {
    const portStr = cleanHost.slice(lastColon + 1);
    if (/^\d+$/.test(portStr)) {
      return { host: cleanHost.slice(0, lastColon), port: Number(portStr) };
    }
  }
  return { host: cleanHost, port: port ?? REMOTE_PORT };
}

// ── TOFU host key verification ───────────────────────────────────────────────

function loadKnownHosts(): Record<string, string> {
  if (!fs.existsSync(REMOTE_KNOWN_HOSTS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REMOTE_KNOWN_HOSTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveKnownHost(hostKey: string, fingerprint: string): void {
  ensureRemoteDir();
  const hosts = loadKnownHosts();
  hosts[hostKey] = fingerprint;
  fs.writeFileSync(REMOTE_KNOWN_HOSTS_PATH, JSON.stringify(hosts, null, 2), { mode: 0o600 });
}

async function confirmPrompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function verifyHostKey(keyBuf: Buffer, host: string, port: number): Promise<boolean> {
  const fingerprint = 'SHA256:' + createHash('sha256').update(keyBuf).digest('base64').replace(/=+$/, '');
  const hostKey = `${host}:${port}`;
  const known = loadKnownHosts();

  if (!known[hostKey]) {
    console.log(chalk.yellow(`\nThe authenticity of host '${hostKey}' can't be established.`));
    console.log(`Host key fingerprint: ${chalk.bold(fingerprint)}`);
    console.log('Confirm this matches the fingerprint shown by "dm remote serve" on that machine.');
    const ok = await confirmPrompt('Trust this host and continue? (yes/no) ');
    if (!ok) return false;
    saveKnownHost(hostKey, fingerprint);
    return true;
  }

  if (known[hostKey] !== fingerprint) {
    console.log(chalk.red.bold('\n⚠  HOST KEY MISMATCH'));
    console.log(chalk.red(`Expected: ${known[hostKey]}`));
    console.log(chalk.red(`Received: ${fingerprint}`));
    console.log(chalk.red('This could indicate a MITM attack. Refusing to connect.'));
    console.log(`To remove the stored key: delete the entry for "${hostKey}" in ${REMOTE_KNOWN_HOSTS_PATH}`);
    return false;
  }

  return true;
}

// ── Main connect entry point ─────────────────────────────────────────────────

export async function connectRemote(host: string, port?: number, identity?: string): Promise<void> {
  const target = parseTarget(host, port);

  // Ensure the user has a key; generate one if missing and print it.
  const keyPath = identity ?? ensureClientKey();
  if (!keyPath) process.exit(1);

  const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : undefined;
  if (!privateKey) {
    Logger.error(`Key file not found: ${keyPath}`);
    process.exit(1);
  }

  const conn = new Client();

  await new Promise<void>((resolve, reject) => {
    conn
      .on('ready', () => {
        conn.shell(
          {
            term: process.env.TERM || 'xterm-256color',
            cols: process.stdout.columns || 80,
            rows: process.stdout.rows || 24,
          },
          (err, stream) => {
            if (err) return reject(err);
            attachInteractive(conn, stream);
            resolve();
          }
        );
      })
      .on('error', (err: Error & { level?: string }) => {
        if (err.level === 'client-authentication') {
          Logger.error('Authentication failed — your public key is not yet authorized on this server.');
          Logger.info('Share your public key with the server admin and ask them to run: dm remote key-add');
          const pubPath = keyPath + '.pub';
          if (fs.existsSync(pubPath)) {
            console.log('');
            console.log(chalk.cyan(fs.readFileSync(pubPath, 'utf8').trim()));
            console.log('');
          }
          process.exit(1);
        }
        reject(err);
      })
      .connect({
        host: target.host,
        port: target.port,
        username: 'dm',
        privateKey,
        hostVerifier: (keyBuf: Buffer, verifyCb: (ok: boolean) => void) => {
          verifyHostKey(keyBuf, target.host, target.port).then(verifyCb).catch(() => verifyCb(false));
        },
      } as any);
  });
}

// ── Wire local terminal to the remote shell ──────────────────────────────────

function attachInteractive(conn: ClientType, stream: NodeJS.ReadWriteStream): void {
  const stdin = process.stdin;
  const wasRaw = stdin.isTTY ? (stdin as any).isRaw : false;

  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.pipe(stream);
  stream.pipe(process.stdout);
  stream.on('stderr', (data: Buffer) => process.stderr.write(data));

  const onResize = () => {
    (stream as any).setWindow?.(process.stdout.rows, process.stdout.columns, 0, 0);
  };
  process.stdout.on('resize', onResize);

  stream.on('close', (code?: number) => {
    process.stdout.removeListener('resize', onResize);
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    stdin.unpipe(stream);
    stdin.pause();
    conn.end();
    process.exit(typeof code === 'number' ? code : 0);
  });
}

// ── Status helpers (used by the remote command) ──────────────────────────────

export { loadKnownHosts, REMOTE_KNOWN_HOSTS_PATH };
