import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'readline';
import { resolve } from 'path';
import { Logger } from '../utils/logger.js';
import { startRemoteServer } from '../utils/ssh-server.js';
import { connectRemote } from '../utils/ssh-client.js';
import { pm2Connect, pm2Disconnect, pm2Start, pm2Delete, describeConnected, getProcessInfo, deletePm2App } from '../utils/pm2-helper.js';
import {
  addAuthorizedKey,
  removeAuthorizedKey,
  listAuthorizedKeys,
} from '../utils/remote-auth.js';
import { REMOTE_PORT, ROOT_DIR } from '../constants.js';

const PM2_NAME = 'dm-remote';

async function remoteServeStart(port: number): Promise<void> {
  try {
    await pm2Connect();
    const { status } = await describeConnected(PM2_NAME);
    if (status !== 'stopped' && status !== 'not-found') {
      Logger.warn(`dm remote server is already running (pm2: ${chalk.bold(PM2_NAME)}, status: ${status}).`);
      Logger.info(`Use ${chalk.cyan('dm remote serve --stop')} to stop it, or ${chalk.cyan('dm remote status')} to check.`);
      return;
    }
    if (status === 'stopped') await pm2Delete(PM2_NAME);
    await pm2Start({
      name: PM2_NAME,
      script: process.execPath,
      args: [resolve(ROOT_DIR, 'dist/cli.js'), 'remote', '_serve-internal', '--port', String(port)],
      cwd: ROOT_DIR,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: process.env as Record<string, string>,
    });
  } finally {
    pm2Disconnect();
  }

  Logger.success(`dm remote server started via PM2 (name: ${chalk.bold(PM2_NAME)}, port: ${chalk.bold(String(port))})`);
  Logger.info(`Logs: ${chalk.cyan(`pm2 logs ${PM2_NAME}`)}`);
  Logger.info(`Stop: ${chalk.cyan('dm remote serve --stop')}`);
}

async function remoteServeStop(): Promise<void> {
  const { status } = await getProcessInfo(PM2_NAME);
  if (status === 'not-found') {
    Logger.warn(`No dm remote server found in PM2 (name: ${chalk.bold(PM2_NAME)}).`);
    return;
  }
  await deletePm2App(PM2_NAME);
  Logger.success(`dm remote server stopped and removed from PM2.`);
}

/** Blocks key-management commands from running inside a remote session. */
function assertNotRemoteSession(): void {
  if (process.env.DM_REMOTE_USER) {
    throw new Error(
      'Key management commands cannot be run from within a remote session. Run them locally on the server.'
    );
  }
}

export async function remoteServe(port: number, stop?: boolean): Promise<void> {
  if (stop) await remoteServeStop();
  else await remoteServeStart(port);
}

/** Internal: invoked by the PM2-managed child — runs the actual server loop. */
export async function remoteServeInternal(port: number): Promise<void> {
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

  try {
    const { status, proc } = await getProcessInfo(PM2_NAME);
    const coloredStatus =
      status === 'online' ? chalk.green(status) :
      status === 'errored' ? chalk.red(status) :
      chalk.yellow(status);
    Logger.info(`Server process  : ${coloredStatus} (pm2: ${chalk.bold(PM2_NAME)})`);
    if (proc?.pid) Logger.info(`PID             : ${chalk.bold(String(proc.pid))}`);
    const uptime = (proc?.pm2_env as any)?.pm_uptime;
    if (uptime) Logger.info(`Uptime          : ${chalk.bold(String(Math.round((Date.now() - uptime) / 1000)))}s`);
  } catch {
    Logger.info(`Server process  : ${chalk.gray('unknown (PM2 unavailable)')}`);
  }
}
