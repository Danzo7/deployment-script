import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'readline';
import { Logger } from '../utils/logger.js';
import { connectRemote } from '../utils/ssh-client.js';
import { addAuthorizedKey, removeAuthorizedKeyByUsername, listAuthorizedKeys, } from '../utils/remote-auth.js';
import { REMOTE_PORT } from '../constants.js';
import { launchRemoteServe } from '../tui/launch-remote-serve.js';
/** Blocks key-management commands from running inside a remote session. */
function assertNotRemoteSession() {
    if (process.env.DM_REMOTE_USER) {
        throw new Error('Key management commands cannot be run from within a remote session. Run them locally on the server.');
    }
}
export async function remoteServe(port) {
    await launchRemoteServe(port);
}
export async function remoteConnect(host, port, identity) {
    await connectRemote(host, port, identity);
}
export async function remoteKeyAdd() {
    assertNotRemoteSession();
    // Interactive prompts: username first, then paste the public key.
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    let name;
    let publicKey;
    try {
        name = (await ask('Username for this key: ')).trim();
        if (!name) {
            Logger.error('No username provided.');
            return;
        }
        Logger.info(`Clients can get their public key by running: ssh-keygen -y -f ~/.ssh/id_ed25519`);
        publicKey = (await ask('Paste the public key: ')).trim();
        if (!publicKey) {
            Logger.error('No key provided.');
            return;
        }
    }
    finally {
        rl.close();
    }
    const key = addAuthorizedKey(publicKey, name);
    Logger.success(`Authorized key added (${key.fingerprint}) — user: ${chalk.bold(key.comment)}`);
}
export async function remoteKeyRemove(username) {
    assertNotRemoteSession();
    const removed = removeAuthorizedKeyByUsername(username);
    if (removed)
        Logger.success(`Removed key for user: ${username}`);
    else
        Logger.error(`No key found for user: ${username}`);
}
export async function remoteKeyList() {
    const keys = listAuthorizedKeys();
    if (!keys.length) {
        Logger.info(`No authorized keys. Add one with: dm remote add`);
        return;
    }
    const table = new Table({ head: ['Fingerprint', 'Comment'] });
    for (const k of keys)
        table.push([k.fingerprint, k.comment || '—']);
    Logger.table(table.toString());
}
export async function remoteStatus() {
    const keys = listAuthorizedKeys();
    Logger.info(`Authorized keys : ${chalk.bold(String(keys.length))}`);
    Logger.info(`Default port    : ${chalk.bold(String(REMOTE_PORT))}`);
    Logger.info(`Auth            : public key only`);
}
export async function remoteRenameUser(oldUsername, newUsername) {
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
