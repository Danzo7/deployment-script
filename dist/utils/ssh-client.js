// ─── dm remote client ────────────────────────────────────────────────────────
//
// `dm remote connect --host <ip> [--port <p>]` — shells out to the system
// ssh executable, mirroring the approach used by dm-connect.ps1 and
// dm-connect.exe. Host key verification (TOFU), known_hosts, and fingerprint
// prompts all work natively because we delegate to the real SSH client.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'child_process';
import fs from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { Logger } from './logger.js';
import { REMOTE_PORT } from '../constants.js';
// Allowed algorithm names → ~/.ssh key filenames.
// Used only to validate an explicitly passed --identity algorithm.
// Must stay in sync with ALGORITHM_KEY_MAP in dm-connect KeyManager.cs.
const ALGORITHM_KEY_MAP = {
    ed25519: 'id_ed25519',
    ed25519_sk: 'id_ed25519_sk', // FIDO2 ed25519 (e.g. YubiKey)
    ecdsa: 'id_ecdsa',
    ecdsa_sk: 'id_ecdsa_sk', // FIDO2 ECDSA (e.g. YubiKey)
};
// Default key — always used when no algorithm is specified.
const DEFAULT_KEY_NAME = 'id_ed25519';
// ── SSH availability check ────────────────────────────────────────────────────
function assertSshAvailable() {
    const result = spawnSync('ssh', ['-V'], { stdio: 'pipe' });
    if (result.error) {
        Logger.error('ssh not found on PATH.');
        Logger.nl();
        Logger.print(chalk.white('  OpenSSH client is required.'));
        if (process.platform === 'win32') {
            Logger.print(chalk.gray('  Settings -> Apps -> Optional Features -> OpenSSH Client'));
            Logger.print(chalk.gray('  Or run in PowerShell (as Admin):'));
            Logger.print(chalk.yellow('    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0'));
        }
        else {
            Logger.print(chalk.gray('  Install via your package manager, e.g.:'));
            Logger.print(chalk.yellow('    apt install openssh-client   # Debian/Ubuntu'));
            Logger.print(chalk.yellow('    brew install openssh         # macOS'));
        }
        Logger.nl();
        process.exit(1);
    }
}
// ── Client key resolution ─────────────────────────────────────────────────────
/**
 * Resolves the private key path to use for connecting.
 * - No algorithm → always uses ~/.ssh/id_ed25519, generates it if missing.
 * - Algorithm provided → must be in the allowed list (ALGORITHM_KEY_MAP),
 *   errors if the key file doesn't exist (no auto-generate for explicit keys).
 *
 * @param algorithm  Optional: ed25519 | ed25519_sk | ecdsa | ecdsa_sk
 * @returns Path to the private key, or undefined if the user declined generation.
 */
export async function ensureClientKey(algorithm) {
    const sshDir = join(homedir(), '.ssh');
    if (algorithm) {
        // Validate the algorithm is in the allowed list.
        const filename = ALGORITHM_KEY_MAP[algorithm.toLowerCase()];
        if (!filename) {
            Logger.error(`Unknown algorithm "${algorithm}". Allowed: ${Object.keys(ALGORITHM_KEY_MAP).join(', ')}`);
            process.exit(1);
        }
        const keyPath = join(sshDir, filename);
        if (fs.existsSync(keyPath))
            return keyPath;
        Logger.error(`No key found at ${keyPath}.`);
        Logger.nl();
        Logger.info(`Generate one with:  ssh-keygen -t ${algorithm} -f "${keyPath}"`);
        process.exit(1);
    }
    // No algorithm — use the default key, generate if missing.
    const defaultPath = join(sshDir, DEFAULT_KEY_NAME);
    if (fs.existsSync(defaultPath)) {
        Logger.info(`Using key: ${defaultPath}`);
        return defaultPath;
    }
    // Default key not found — offer to generate it.
    Logger.nl();
    Logger.warn(`No key found at ${defaultPath}.`);
    Logger.nl();
    const confirmed = await new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(chalk.white('  Would you like to generate a new ed25519 key pair now? (yes/no) '), (ans) => {
            rl.close();
            resolve(/^y(es)?$/i.test(ans.trim()));
        });
    });
    if (!confirmed) {
        Logger.nl();
        Logger.info('To generate a key manually, run:');
        Logger.print(chalk.yellow(`    ssh-keygen -t ed25519 -f "${defaultPath}"`));
        Logger.nl();
        Logger.info(`Then share the public key (${defaultPath}.pub) with your server admin.`);
        return undefined;
    }
    if (!fs.existsSync(sshDir))
        fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    Logger.nl();
    Logger.info('Generating ed25519 key pair...');
    const gen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', defaultPath, '-N', ''], {
        stdio: 'inherit',
    });
    if (gen.status !== 0 || !fs.existsSync(defaultPath)) {
        Logger.error('Key generation failed.');
        process.exit(1);
    }
    Logger.success(`Key generated: ${defaultPath}`);
    showPublicKey(defaultPath);
    Logger.warn('Share the public key above with your server admin before connecting.');
    await new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(chalk.white('  Press Enter once your key has been authorized, or Ctrl+C to cancel. '), () => {
            rl.close();
            resolve();
        });
    });
    return defaultPath;
}
// ── Public key display ────────────────────────────────────────────────────────
export function showPublicKey(privateKeyPath) {
    const pubPath = privateKeyPath + '.pub';
    if (!fs.existsSync(pubPath))
        return;
    const pubKey = fs.readFileSync(pubPath, 'utf8').trim();
    Logger.nl();
    Logger.print(chalk.white('  Your public key:'));
    Logger.divider(53);
    Logger.print(chalk.cyan(`  ${pubKey}`));
    Logger.divider(53);
    Logger.nl();
}
// ── Main connect entry point ──────────────────────────────────────────────────
export async function connectRemote(host, port, identity, command) {
    assertSshAvailable();
    const targetPort = port ?? REMOTE_PORT;
    const cleanHost = host.includes('@')
        ? host.slice(host.indexOf('@') + 1)
        : host;
    const keyPath = await ensureClientKey(identity);
    if (!keyPath)
        process.exit(0);
    if (!command || command.length === 0) {
        Logger.nl();
        Logger.info(`Connecting to ${cleanHost}:${targetPort} ...`);
        Logger.nl();
    }
    const sshArgs = [
        '-tt', // Force PTY allocation for proper ANSI handling
        '-p',
        String(targetPort),
        '-i',
        keyPath,
        '-o',
        'StrictHostKeyChecking=ask',
        '-o',
        'BatchMode=no',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        `dm@${cleanHost}`,
    ];
    // Append command args if provided for exec mode
    if (command && command.length > 0) {
        sshArgs.push(...command);
    }
    const result = spawnSync('ssh', sshArgs, { stdio: 'inherit' });
    const exitCode = result.status ?? 1;
    if (exitCode === 255) {
        Logger.nl();
        Logger.error('Connection failed. Possible causes:');
        Logger.print(chalk.gray(`  - Server is not reachable at ${cleanHost}:${targetPort}`));
        Logger.print(chalk.gray('  - Your public key is not authorized on the server'));
        Logger.nl();
        showPublicKey(keyPath);
        Logger.info('Share the public key above with your server admin, then try again.');
        process.exit(1);
    }
    process.exit(exitCode);
}
