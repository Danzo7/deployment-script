// ─── Remote Service Installer ─────────────────────────────────────────────────
//
// Install/uninstall the remote SSH server as a system service:
// - Linux: systemd unit
// - Windows: Task Scheduler task
// ─────────────────────────────────────────────────────────────────────────────

import { execa } from 'execa';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { userInfo } from 'os';
import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { execSync } from 'child_process';
import { REMOTE_PORT } from '../constants.js';

interface ServiceOptions {
  uninstall?: boolean;
  port?: number;
}

const SERVICE_NAME = 'dm-remote';
const SERVICE_DISPLAY_NAME = 'DM Remote SSH Server';
const SERVICE_DESCRIPTION = 'Provides SSH access to dm CLI remotely';
const SYSTEMD_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;
const SCHTASKS_TASK_NAME = 'DMRemoteServer';

/**
 * Main entry point
 */
export async function remoteInstallService(
  options: ServiceOptions = {}
): Promise<void> {
  const platform = process.platform;

  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error(
      'Service management is only supported on Windows and Linux.'
    );
  }

  if (options.uninstall) {
    platform === 'win32' ? await uninstallWindows() : await uninstallLinux();
  } else {
    const port = options.port ?? REMOTE_PORT;
    platform === 'win32'
      ? await installWindows(port)
      : await installLinux(port);
  }
}

// ── Binary resolution ──────────────────────────────────────────────────────────

function resolveInvocation(): { node: string; script: string } {
  return {
    node: process.execPath,
    script: process.argv[1],
  };
}

// ── Linux — systemd ────────────────────────────────────────────────────────────

async function installLinux(port: number): Promise<void> {
  Logger.info(chalk.cyan('Installing systemd service for remote server...'));

  assertLinuxPrivileges();

  const { node, script } = resolveInvocation();
  const user = userInfo().username;

  const unitContent = buildSystemdUnit(node, script, user, port);

  try {
    writeFileSync(SYSTEMD_UNIT_PATH, unitContent, { encoding: 'utf-8' });
  } catch (err: any) {
    throw new Error(
      `Failed to write unit file: ${err.message}\nTip: run this command with sudo.`
    );
  }

  Logger.info(chalk.green(`Written: ${SYSTEMD_UNIT_PATH}`));

  await runCommand(
    'systemctl',
    ['daemon-reload'],
    'Reloading systemd daemon'
  );
  await runCommand(
    'systemctl',
    ['enable', `${SERVICE_NAME}.service`],
    `Enabling ${SERVICE_NAME}`
  );
  await runCommand(
    'systemctl',
    ['start', `${SERVICE_NAME}.service`],
    `Starting ${SERVICE_NAME}`
  );

  Logger.info(chalk.bold.green('\n✔ Service installed and started.'));
  Logger.info(
    `  Status : ${chalk.cyan(`systemctl status ${SERVICE_NAME}.service`)}`
  );
  Logger.info(
    `  Logs   : ${chalk.cyan(`journalctl -u ${SERVICE_NAME}.service -f`)}`
  );
  Logger.info(
    `  Remove : ${chalk.cyan('dm remote install-service --uninstall')}`
  );
}

async function uninstallLinux(): Promise<void> {
  Logger.info(chalk.cyan('Uninstalling systemd service...'));

  assertLinuxPrivileges();

  await runCommand(
    'systemctl',
    ['stop', `${SERVICE_NAME}.service`],
    'Stopping service',
    { ignoreErrors: true }
  );
  await runCommand(
    'systemctl',
    ['disable', `${SERVICE_NAME}.service`],
    'Disabling service',
    { ignoreErrors: true }
  );

  if (existsSync(SYSTEMD_UNIT_PATH)) {
    try {
      unlinkSync(SYSTEMD_UNIT_PATH);
      Logger.info(chalk.green(`Removed: ${SYSTEMD_UNIT_PATH}`));
    } catch (err: any) {
      throw new Error(`Could not remove unit file: ${err.message}`);
    }
  } else {
    Logger.warn(
      `Unit file not found at ${SYSTEMD_UNIT_PATH} — already removed?`
    );
  }

  await runCommand(
    'systemctl',
    ['daemon-reload'],
    'Reloading systemd daemon'
  );

  Logger.info(chalk.bold.green('\n✔ Service uninstalled.'));
}

function buildSystemdUnit(
  node: string,
  script: string,
  user: string,
  port: number
): string {
  return `[Unit]
Description=${SERVICE_DISPLAY_NAME}
After=network.target

[Service]
Type=simple
User=${user}
ExecStart=${node} ${script} remote start --port ${port}
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

function assertLinuxPrivileges(): void {
  if (process.getuid?.() !== 0) {
    throw new Error(
      `This command must be run as root.\n  Re-run with: ${chalk.cyan('sudo dm remote install-service')}`
    );
  }
}

// ── Windows — Task Scheduler ───────────────────────────────────────────────────

async function installWindows(port: number): Promise<void> {
  Logger.info(chalk.cyan('Installing Windows service via Task Scheduler...'));

  assertWindowsPrivileges();

  const { node, script } = resolveInvocation();
  const taskRun = `"${node}" "${script}" remote start --port ${port} --daemon`;

  await runCommand(
    'schtasks',
    [
      '/Create',
      '/F',
      '/SC',
      'ONSTART',
      '/DELAY',
      '0000:10',
      '/RU',
      'SYSTEM',
      '/TN',
      SCHTASKS_TASK_NAME,
      '/TR',
      taskRun,
      '/RL',
      'HIGHEST',
    ],
    `Registering task "${SCHTASKS_TASK_NAME}"`
  );

  Logger.info(chalk.bold.green('\n✔ Startup task registered.'));
  Logger.info(
    `  Verify : ${chalk.cyan(`schtasks /Query /TN "${SCHTASKS_TASK_NAME}" /FO LIST`)}`
  );
  Logger.info(
    `  Run now: ${chalk.cyan(`schtasks /Run /TN "${SCHTASKS_TASK_NAME}"`)}`
  );
  Logger.info(
    `  Remove : ${chalk.cyan('dm remote install-service --uninstall')}`
  );
}

async function uninstallWindows(): Promise<void> {
  Logger.info(chalk.cyan('Removing Windows service...'));

  assertWindowsPrivileges();

  await runCommand(
    'schtasks',
    ['/Delete', '/F', '/TN', SCHTASKS_TASK_NAME],
    `Removing task "${SCHTASKS_TASK_NAME}"`,
    { ignoreErrors: true }
  );

  Logger.info(chalk.bold.green('\n✔ Startup task removed.'));
}

function assertWindowsPrivileges(): void {
  try {
    execSync('net session', { stdio: 'ignore' });
  } catch {
    throw new Error(
      `Administrator privileges are required.\n  Re-run this terminal as Administrator and try again.`
    );
  }
}

// ── Shared helper ──────────────────────────────────────────────────────────────

interface RunOptions {
  ignoreErrors?: boolean;
}

async function runCommand(
  bin: string,
  args: string[],
  description: string,
  options: RunOptions = {}
): Promise<void> {
  Logger.info(chalk.gray(`  → ${description}...`));

  try {
    await execa(bin, args, { stdio: 'pipe' });
  } catch (err: any) {
    if (options.ignoreErrors) {
      Logger.warn(
        `  ⚠ ${description} failed (ignored): ${err.shortMessage ?? err.message}`
      );
      return;
    }

    Logger.error(
      `  ✖ ${description} failed: ${err.shortMessage ?? err.message}`
    );

    if (err.stderr) {
      Logger.error(chalk.gray(err.stderr.trim()));
    }

    throw new Error(
      `${description} failed: ${err.shortMessage ?? err.message}`
    );
  }
}
