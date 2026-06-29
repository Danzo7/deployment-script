/* eslint-disable @typescript-eslint/no-unused-expressions */
import { execa } from 'execa';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { userInfo } from 'os';
import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceOptions {
  uninstall?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_NAME = 'dm-startup';
const SERVICE_DISPLAY_NAME = 'Deployment Manager Startup';
const SERVICE_DESCRIPTION = 'Runs "dm start-all" on system boot';
const SYSTEMD_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;
const SCHTASKS_TASK_NAME = 'DMStartupService';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function installService(options: ServiceOptions = {}): Promise<void> {
  const platform = process.platform;

  if (platform !== 'win32' && platform !== 'linux') {
    Logger.error('Service management is only supported on Windows and Linux.');
    process.exit(1);
  }

  if (options.uninstall) {
    platform === 'win32' ? await uninstallWindows() : await uninstallLinux();
  } else {
    platform === 'win32' ? await installWindows() : await installLinux();
  }
}

// ---------------------------------------------------------------------------
// Binary resolution
//
// Since dm is a Node.js CLI tool installed via npm link, we always know
// exactly two things at runtime:
//   • process.execPath  → the node binary that is running right now
//   • process.argv[1]   → the JS entry file being executed
//
// This is more reliable than `which`/`where` because:
//   - On Linux, `which dm` returns the npm symlink — fine in a terminal, but
//     systemd resolves symlinks at unit-parse time, so it works either way.
//     Using process.argv[1] directly skips the symlink entirely.
//   - On Windows, `where dm` returns dm.cmd — a CMD wrapper that is unreliable
//     when run as SYSTEM (stripped PATH, no cmd.exe guarantees). Calling node
//     explicitly avoids that entirely.
//
// Result on both platforms: "node /absolute/path/to/cli.js"
// ---------------------------------------------------------------------------

function resolveInvocation(): { node: string; script: string } {
  return {
    node: process.execPath,   // e.g. /usr/local/bin/node  or  C:\Program Files\nodejs\node.exe
    script: process.argv[1],  // e.g. /usr/local/lib/node_modules/dm/dist/cli.js
  };
}

// ---------------------------------------------------------------------------
// Linux — systemd
// ---------------------------------------------------------------------------

async function installLinux(): Promise<void> {
  Logger.info(chalk.cyan('Installing systemd service…'));

  assertLinuxPrivileges();

  const { node, script } = resolveInvocation();
  const user = userInfo().username;

  const unitContent = buildSystemdUnit(node, script, user);

  // Write unit file directly (we are root at this point)
  try {
    writeFileSync(SYSTEMD_UNIT_PATH, unitContent, { encoding: 'utf-8' });
  } catch (err: any) {
    Logger.error(`Failed to write unit file: ${err.message}`);
    Logger.info(chalk.yellow('Tip: run this command with sudo.'));
    process.exit(1);
  }

  Logger.info(chalk.green(`Written: ${SYSTEMD_UNIT_PATH}`));

  await runCommand('systemctl', ['daemon-reload'], 'Reloading systemd daemon');
  await runCommand('systemctl', ['enable', `${SERVICE_NAME}.service`], `Enabling ${SERVICE_NAME}`);
  await runCommand('systemctl', ['start', `${SERVICE_NAME}.service`], `Starting ${SERVICE_NAME}`);

  Logger.info(chalk.bold.green('\n✔ Service installed and started.'));
  Logger.info(`  Status : ${chalk.cyan(`systemctl status ${SERVICE_NAME}.service`)}`);
  Logger.info(`  Logs   : ${chalk.cyan(`journalctl -u ${SERVICE_NAME}.service -f`)}`);
  Logger.info(`  Remove : ${chalk.cyan('dm install-service --uninstall')}`);
}

async function uninstallLinux(): Promise<void> {
  Logger.info(chalk.cyan('Uninstalling systemd service…'));

  assertLinuxPrivileges();

  // Stop and disable — ignore errors if already stopped/disabled
  await runCommand('systemctl', ['stop', `${SERVICE_NAME}.service`], 'Stopping service', { ignoreErrors: true });
  await runCommand('systemctl', ['disable', `${SERVICE_NAME}.service`], 'Disabling service', { ignoreErrors: true });

  if (existsSync(SYSTEMD_UNIT_PATH)) {
    try {
      unlinkSync(SYSTEMD_UNIT_PATH);
      Logger.info(chalk.green(`Removed: ${SYSTEMD_UNIT_PATH}`));
    } catch (err: any) {
      Logger.error(`Could not remove unit file: ${err.message}`);
      process.exit(1);
    }
  } else {
    Logger.warn(`Unit file not found at ${SYSTEMD_UNIT_PATH} — already removed?`);
  }

  await runCommand('systemctl', ['daemon-reload'], 'Reloading systemd daemon');

  Logger.info(chalk.bold.green('\n✔ Service uninstalled.'));
}

function buildSystemdUnit(node: string, script: string, user: string): string {
  return `[Unit]
Description=${SERVICE_DISPLAY_NAME} — ${SERVICE_DESCRIPTION}
After=network.target

[Service]
Type=oneshot
User=${user}
ExecStartPre=/bin/sleep 5
ExecStart=${node} ${script} start-all
StandardOutput=journal
StandardError=journal
# Do not restart — this is a one-shot boot task, not a daemon
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;
}

function assertLinuxPrivileges(): void {
  if (process.getuid?.() !== 0) {
    Logger.error('This command must be run as root.');
    Logger.info(chalk.yellow(`  Re-run with: ${chalk.cyan('sudo dm install-service')}`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Windows — Task Scheduler (schtasks)
//
// We use schtasks rather than node-windows because:
//  • No runtime npm dependency to install
//  • Ships with every Windows version since XP
//  • ONSTART trigger runs as SYSTEM before any user logs in (correct for servers)
//  • Uninstall is a single command — no leftover registry/service entries
// ---------------------------------------------------------------------------

async function installWindows(): Promise<void> {
  Logger.info(chalk.cyan('Installing Windows startup task via Task Scheduler…'));

  assertWindowsPrivileges();

  const { node, script } = resolveInvocation();

  // Build the /TR value: node.exe "C:\path\to\cli.js" start-all
  // Both paths are quoted to handle spaces (e.g. "C:\Program Files\nodejs\node.exe")
  const taskRun = `"${node}" "${script}" start-all`;

  await runCommand(
    'schtasks',
    [
      '/Create',
      '/F',                        // overwrite if already exists
      '/SC', 'ONSTART',            // trigger: at system startup
      '/DELAY', '0000:10',         // 10-second delay after boot for network
      '/RU', 'SYSTEM',             // run as SYSTEM (no user session needed)
      '/TN', SCHTASKS_TASK_NAME,
      '/TR', taskRun,
      '/RL', 'HIGHEST',            // highest privilege level
    ],
    `Registering task "${SCHTASKS_TASK_NAME}"`,
  );

  Logger.info(chalk.bold.green('\n✔ Startup task registered.'));
  Logger.info(`  Verify : ${chalk.cyan(`schtasks /Query /TN "${SCHTASKS_TASK_NAME}" /FO LIST`)}`);
  Logger.info(`  Run now: ${chalk.cyan(`schtasks /Run /TN "${SCHTASKS_TASK_NAME}"`)}`);
  Logger.info(`  Remove : ${chalk.cyan('dm install-service --uninstall')}`);
}

async function uninstallWindows(): Promise<void> {
  Logger.info(chalk.cyan('Removing Windows startup task…'));

  assertWindowsPrivileges();

  await runCommand(
    'schtasks',
    ['/Delete', '/F', '/TN', SCHTASKS_TASK_NAME],
    `Removing task "${SCHTASKS_TASK_NAME}"`,
    { ignoreErrors: true },
  );

  Logger.info(chalk.bold.green('\n✔ Startup task removed.'));
}

function assertWindowsPrivileges(): void {
  // On Windows, check for admin by attempting to read a protected path.
  // A cleaner runtime check without shelling out.
  try {
    execSync('net session', { stdio: 'ignore' });
  } catch {
    Logger.error('Administrator privileges are required.');
    Logger.info(chalk.yellow('  Re-run this terminal as Administrator and try again.'));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

interface RunOptions {
  ignoreErrors?: boolean;
}

async function runCommand(
  bin: string,
  args: string[],
  description: string,
  options: RunOptions = {},
): Promise<void> {
  Logger.info(chalk.gray(`  → ${description}…`));

  try {
    await execa(bin, args, { stdio: 'pipe' });
  } catch (err: any) {
    if (options.ignoreErrors) {
      Logger.warn(`  ⚠ ${description} failed (ignored): ${err.shortMessage ?? err.message}`);
      return;
    }

    Logger.error(`  ✖ ${description} failed: ${err.shortMessage ?? err.message}`);

    if (err.stderr) {
      Logger.error(chalk.gray(err.stderr.trim()));
    }

    process.exit(1);
  }
}