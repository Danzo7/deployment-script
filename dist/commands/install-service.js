import { execa } from "execa";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { userInfo } from "os";
import chalk from "chalk";
import { Logger } from "../utils/logger.js";
import { execSync } from "child_process";
const SERVICE_NAME = "dm-startup";
const SERVICE_DISPLAY_NAME = "Deployment Manager Startup";
const SERVICE_DESCRIPTION = 'Runs "dm start-all" on system boot';
const SYSTEMD_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;
const SCHTASKS_TASK_NAME = "DMStartupService";
async function installService(options = {}) {
  const platform = process.platform;
  if (platform !== "win32" && platform !== "linux") {
    throw new Error("Service management is only supported on Windows and Linux.");
  }
  if (options.uninstall) {
    platform === "win32" ? await uninstallWindows() : await uninstallLinux();
  } else {
    platform === "win32" ? await installWindows() : await installLinux();
  }
}
function resolveInvocation() {
  return {
    node: process.execPath,
    // e.g. /usr/local/bin/node  or  C:\Program Files\nodejs\node.exe
    script: process.argv[1]
    // e.g. /usr/local/lib/node_modules/dm/dist/cli.js
  };
}
async function installLinux() {
  Logger.info(chalk.cyan("Installing systemd service\u2026"));
  assertLinuxPrivileges();
  const { node, script } = resolveInvocation();
  const user = userInfo().username;
  const unitContent = buildSystemdUnit(node, script, user);
  try {
    writeFileSync(SYSTEMD_UNIT_PATH, unitContent, { encoding: "utf-8" });
  } catch (err) {
    throw new Error(`Failed to write unit file: ${err.message}
Tip: run this command with sudo.`);
  }
  Logger.info(chalk.green(`Written: ${SYSTEMD_UNIT_PATH}`));
  await runCommand("systemctl", ["daemon-reload"], "Reloading systemd daemon");
  await runCommand(
    "systemctl",
    ["enable", `${SERVICE_NAME}.service`],
    `Enabling ${SERVICE_NAME}`
  );
  await runCommand(
    "systemctl",
    ["start", `${SERVICE_NAME}.service`],
    `Starting ${SERVICE_NAME}`
  );
  Logger.info(chalk.bold.green("\n\u2714 Service installed and started."));
  Logger.info(
    `  Status : ${chalk.cyan(`systemctl status ${SERVICE_NAME}.service`)}`
  );
  Logger.info(
    `  Logs   : ${chalk.cyan(`journalctl -u ${SERVICE_NAME}.service -f`)}`
  );
  Logger.info(`  Remove : ${chalk.cyan("dm install-service --uninstall")}`);
}
async function uninstallLinux() {
  Logger.info(chalk.cyan("Uninstalling systemd service\u2026"));
  assertLinuxPrivileges();
  await runCommand(
    "systemctl",
    ["stop", `${SERVICE_NAME}.service`],
    "Stopping service",
    { ignoreErrors: true }
  );
  await runCommand(
    "systemctl",
    ["disable", `${SERVICE_NAME}.service`],
    "Disabling service",
    { ignoreErrors: true }
  );
  if (existsSync(SYSTEMD_UNIT_PATH)) {
    try {
      unlinkSync(SYSTEMD_UNIT_PATH);
      Logger.info(chalk.green(`Removed: ${SYSTEMD_UNIT_PATH}`));
    } catch (err) {
      throw new Error(`Could not remove unit file: ${err.message}`);
    }
  } else {
    Logger.warn(
      `Unit file not found at ${SYSTEMD_UNIT_PATH} \u2014 already removed?`
    );
  }
  await runCommand("systemctl", ["daemon-reload"], "Reloading systemd daemon");
  Logger.info(chalk.bold.green("\n\u2714 Service uninstalled."));
}
function buildSystemdUnit(node, script, user) {
  return `[Unit]
Description=${SERVICE_DISPLAY_NAME} \u2014 ${SERVICE_DESCRIPTION}
After=network.target

[Service]
Type=oneshot
User=${user}
ExecStartPre=/bin/sleep 5
ExecStart=${node} ${script} start-all
StandardOutput=journal
StandardError=journal
# Do not restart \u2014 this is a one-shot boot task, not a daemon
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;
}
function assertLinuxPrivileges() {
  if (process.getuid?.() !== 0) {
    throw new Error(
      `This command must be run as root.
  Re-run with: ${chalk.cyan("sudo dm install-service")}`
    );
  }
}
async function installWindows() {
  Logger.info(
    chalk.cyan("Installing Windows startup task via Task Scheduler\u2026")
  );
  assertWindowsPrivileges();
  const { node, script } = resolveInvocation();
  const taskRun = `"${node}" "${script}" start-all`;
  await runCommand(
    "schtasks",
    [
      "/Create",
      "/F",
      // overwrite if already exists
      "/SC",
      "ONSTART",
      // trigger: at system startup
      "/DELAY",
      "0000:10",
      // 10-second delay after boot for network
      "/RU",
      "SYSTEM",
      // run as SYSTEM (no user session needed)
      "/TN",
      SCHTASKS_TASK_NAME,
      "/TR",
      taskRun,
      "/RL",
      "HIGHEST"
      // highest privilege level
    ],
    `Registering task "${SCHTASKS_TASK_NAME}"`
  );
  Logger.info(chalk.bold.green("\n\u2714 Startup task registered."));
  Logger.info(
    `  Verify : ${chalk.cyan(`schtasks /Query /TN "${SCHTASKS_TASK_NAME}" /FO LIST`)}`
  );
  Logger.info(
    `  Run now: ${chalk.cyan(`schtasks /Run /TN "${SCHTASKS_TASK_NAME}"`)}`
  );
  Logger.info(`  Remove : ${chalk.cyan("dm install-service --uninstall")}`);
}
async function uninstallWindows() {
  Logger.info(chalk.cyan("Removing Windows startup task\u2026"));
  assertWindowsPrivileges();
  await runCommand(
    "schtasks",
    ["/Delete", "/F", "/TN", SCHTASKS_TASK_NAME],
    `Removing task "${SCHTASKS_TASK_NAME}"`,
    { ignoreErrors: true }
  );
  Logger.info(chalk.bold.green("\n\u2714 Startup task removed."));
}
function assertWindowsPrivileges() {
  try {
    execSync("net session", { stdio: "ignore" });
  } catch {
    throw new Error(
      `Administrator privileges are required.
  Re-run this terminal as Administrator and try again.`
    );
  }
}
async function runCommand(bin, args, description, options = {}) {
  Logger.info(chalk.gray(`  \u2192 ${description}\u2026`));
  try {
    await execa(bin, args, { stdio: "pipe" });
  } catch (err) {
    if (options.ignoreErrors) {
      Logger.warn(
        `  \u26A0 ${description} failed (ignored): ${err.shortMessage ?? err.message}`
      );
      return;
    }
    Logger.error(
      `  \u2716 ${description} failed: ${err.shortMessage ?? err.message}`
    );
    if (err.stderr) {
      Logger.error(chalk.gray(err.stderr.trim()));
    }
    throw new Error(`${description} failed: ${err.shortMessage ?? err.message}`);
  }
}
export {
  installService
};
