import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'readline';
import { Logger } from '../utils/logger.js';
import { startRemoteServer } from '../utils/ssh-server.js';
import { connectRemote } from '../utils/ssh-client.js';
import {
  addAuthorizedKey,
  removeAuthorizedKey,
  listAuthorizedKeys,
} from '../utils/remote-auth.js';
import { REMOTE_PORT } from '../constants.js';

/** Blocks key-management commands from running inside a remote session. */
function assertNotRemoteSession(): void {
  if (process.env.DM_REMOTE_USER) {
    throw new Error(
      'Key management commands cannot be run from within a remote session. Run them locally on the server.'
    );
  }
}

export async function remoteServe(port: number): Promise<void> {
  await startRemoteServer(port);
}



export async function remoteConnect(host: string, port?: number, identity?: string): Promise<void> {
  await connectRemote(host, port, identity);
}

export async function remoteKeyAdd(): Promise<void> {
  assertNotRemoteSession();

  // Interactive prompts: paste key, then provide a name.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  let publicKey: string;
  let name: string;
  try {
    publicKey = (await ask('Paste the public key: ')).trim();
    if (!publicKey) { Logger.error('No key provided.'); return; }
    name = (await ask('Name / username for this key: ')).trim();
    if (!name) { Logger.error('No name provided.'); return; }
  } finally {
    rl.close();
  }

  const key = addAuthorizedKey(publicKey, name);
  Logger.success(`Authorized key added (${key.fingerprint}) — user: ${chalk.bold(key.comment)}`);
}

export async function remoteKeyRemove(fingerprint: string): Promise<void> {
  assertNotRemoteSession();
  const removed = removeAuthorizedKey(fingerprint);
  if (removed) Logger.success(`Removed key ${fingerprint}`);
  else Logger.error(`No key found matching fingerprint: ${fingerprint}`);
}

export async function remoteKeyList(): Promise<void> {
  const keys = listAuthorizedKeys();
  if (!keys.length) {
    Logger.info(`No authorized keys. Add one with: dm remote key-add "$(cat ~/.ssh/id_ed25519.pub)"`);
    return;
  }
  const table = new Table({ head: ['Fingerprint', 'Comment'] });
  for (const k of keys) table.push([k.fingerprint, k.comment || '—']);
  console.log(table.toString());
}

export async function remoteStatus(): Promise<void> {
  const keys = listAuthorizedKeys();
  Logger.info(`Authorized keys : ${chalk.bold(String(keys.length))}`);
  Logger.info(`Default port    : ${chalk.bold(String(REMOTE_PORT))}`);
  Logger.info(`Auth            : public key only`);
}
