import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'readline';
import { Logger } from '../utils/logger.js';
import { connectRemote } from '../utils/ssh-client.js';
import {
  addAuthorizedKey,
  removeAuthorizedKeyByUsername,
  listAuthorizedKeys,
} from '../utils/remote-auth.js';
import { REMOTE_PORT, REMOTE_IPC_SOCKET_PATH } from '../constants.js';
import { RemoteIpcClient } from '../utils/remote-ipc-client.js';
import { PidManager } from '../utils/pid-manager.js';
import { REMOTE_PID_FILE_PATH } from '../constants.js';

/** Blocks key-management commands from running inside a remote session. */
function assertNotRemoteSession(): void {
  if (process.env.DM_REMOTE_USER) {
    throw new Error(
      'Key management commands cannot be run from within a remote session. Run them locally on the server.'
    );
  }
}

export async function remoteServe(port: number): Promise<void> {
  // Check if server is running
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  const isRunning = pidManager.isValid();

  if (!isRunning) {
    Logger.warn('Remote server is not running.');
    Logger.info(`  Start server: ${chalk.cyan('dm remote start')}`);
    Logger.info(`  Or launch with server: ${chalk.cyan('dm remote start')} (then use ${chalk.cyan('dm remote status')} to view)`);
    Logger.nl();
    Logger.info(chalk.gray('Starting server inline for this session (legacy mode)...'));
    Logger.nl();
  }

  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');

  await launchPage({
    pageId: PageId.RemoteServe,
    params: { port, legacyMode: !isRunning },
    fullScreen: true,
  });
}

/**
 * Show remote server status (TUI dashboard)
 * This is the new recommended way to view server status
 */
export async function remoteStatus(): Promise<void> {
  // Check if server is running
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  
  if (!pidManager.isValid()) {
    pidManager.cleanStale();
    Logger.error('Remote server is not running');
    Logger.info(`  Start server: ${chalk.cyan('dm remote start')}`);
    process.exit(1);
  }

  // Verify IPC connectivity
  try {
    const client = new RemoteIpcClient(REMOTE_IPC_SOCKET_PATH);
    await client.connect();
    await client.ping();
    client.disconnect();
  } catch (err: any) {
    Logger.error(`Cannot connect to remote server: ${err.message}`);
    Logger.info(`  Try restarting: ${chalk.cyan('dm remote restart')}`);
    process.exit(1);
  }

  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');

  await launchPage({
    pageId: PageId.RemoteServe,
    params: { port: REMOTE_PORT, legacyMode: false },
    fullScreen: true,
  });
}

export async function remoteConnect(
  host: string,
  port?: number,
  identity?: string
): Promise<void> {
  await connectRemote(host, port, identity);
}

export async function remoteKeyAdd(): Promise<void> {
  assertNotRemoteSession();

  // Interactive prompts: username first, then paste the public key.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, res));

  let name: string;
  let publicKey: string;
  try {
    name = (await ask('Username for this key: ')).trim();
    if (!name) {
      Logger.error('No username provided.');
      return;
    }
    Logger.info(
      `Clients can get their public key by running: ssh-keygen -y -f ~/.ssh/id_ed25519`
    );
    publicKey = (await ask('Paste the public key: ')).trim();
    if (!publicKey) {
      Logger.error('No key provided.');
      return;
    }
  } finally {
    rl.close();
  }

  const key = addAuthorizedKey(publicKey, name);
  Logger.success(
    `Authorized key added (${key.fingerprint}) — user: ${chalk.bold(key.comment)}`
  );
}

export async function remoteKeyRemove(username: string): Promise<void> {
  assertNotRemoteSession();
  const removed = removeAuthorizedKeyByUsername(username);
  if (removed) Logger.success(`Removed key for user: ${username}`);
  else Logger.error(`No key found for user: ${username}`);
}

export async function remoteKeyList(): Promise<void> {
  const keys = listAuthorizedKeys();
  if (!keys.length) {
    Logger.info(`No authorized keys. Add one with: dm remote add`);
    return;
  }
  const table = new Table({ head: ['Fingerprint', 'Comment'] });
  for (const k of keys) table.push([k.fingerprint, k.comment || '—']);
  Logger.table(table.toString());
}

export async function remoteInfo(): Promise<void> {
  const keys = listAuthorizedKeys();
  const pidManager = new PidManager(REMOTE_PID_FILE_PATH);
  const isRunning = pidManager.isValid();

  Logger.info(`Server status   : ${isRunning ? chalk.green('Running') : chalk.gray('Stopped')}`);
  Logger.info(`Authorized keys : ${chalk.bold(String(keys.length))}`);
  Logger.info(`Default port    : ${chalk.bold(String(REMOTE_PORT))}`);
  Logger.info(`Auth            : public key only`);
  
  if (isRunning) {
    try {
      const client = new RemoteIpcClient(REMOTE_IPC_SOCKET_PATH);
      await client.connect();
      const status = await client.getStatus();
      client.disconnect();
      
      Logger.info(`Active sessions : ${chalk.bold(String(status.activeSessions))}`);
      Logger.info(`Uptime          : ${chalk.bold(String(Math.floor(status.uptime / 1000)))}s`);
    } catch {
      /* ignore if can't get extra info */
    }
  }
}

export async function remoteRenameUser(oldUsername: string, newUsername: string): Promise<void> {
  assertNotRemoteSession();
  
  if (!oldUsername || !newUsername) {
    throw new Error('Both old and new usernames are required');
  }

  if (oldUsername === newUsername) {
    throw new Error('Old and new usernames must be different');
  }

  const keys = listAuthorizedKeys();
  const keyToRename = keys.find(k => k.comment === oldUsername);
  
  if (!keyToRename) {
    Logger.error(`User "${oldUsername}" not found`);
    return;
  }

  // Remove old key and add with new username
  removeAuthorizedKeyByUsername(oldUsername);
  addAuthorizedKey(keyToRename.raw, newUsername);
  
  Logger.success(`Renamed user "${oldUsername}" to "${newUsername}"`);
}
