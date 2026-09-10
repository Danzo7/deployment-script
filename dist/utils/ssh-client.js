import { spawnSync } from "child_process";
import fs from "fs";
import { homedir } from "os";
import { join } from "path";
import readline from "readline";
import chalk from "chalk";
import { Logger } from "./logger.js";
import { REMOTE_PORT } from "../constants.js";
const ALGORITHM_KEY_MAP = {
  ed25519: "id_ed25519",
  ed25519_sk: "id_ed25519_sk",
  // FIDO2 ed25519 (e.g. YubiKey)
  ecdsa: "id_ecdsa",
  ecdsa_sk: "id_ecdsa_sk"
  // FIDO2 ECDSA (e.g. YubiKey)
};
const DEFAULT_KEY_NAME = "id_ed25519";
function assertSshAvailable() {
  const result = spawnSync("ssh", ["-V"], { stdio: "pipe" });
  if (result.error) {
    Logger.error("ssh not found on PATH.");
    Logger.nl();
    Logger.print(chalk.white("  OpenSSH client is required."));
    if (process.platform === "win32") {
      Logger.print(
        chalk.gray("  Settings -> Apps -> Optional Features -> OpenSSH Client")
      );
      Logger.print(chalk.gray("  Or run in PowerShell (as Admin):"));
      Logger.print(
        chalk.yellow(
          "    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
        )
      );
    } else {
      Logger.print(chalk.gray("  Install via your package manager, e.g.:"));
      Logger.print(
        chalk.yellow("    apt install openssh-client   # Debian/Ubuntu")
      );
      Logger.print(chalk.yellow("    brew install openssh         # macOS"));
    }
    Logger.nl();
    process.exit(1);
  }
}
async function ensureClientKey(algorithm) {
  const sshDir = join(homedir(), ".ssh");
  if (algorithm) {
    const filename = ALGORITHM_KEY_MAP[algorithm.toLowerCase()];
    if (!filename) {
      Logger.error(
        `Unknown algorithm "${algorithm}". Allowed: ${Object.keys(ALGORITHM_KEY_MAP).join(", ")}`
      );
      process.exit(1);
    }
    const keyPath = join(sshDir, filename);
    if (fs.existsSync(keyPath)) return keyPath;
    Logger.error(`No key found at ${keyPath}.`);
    Logger.nl();
    Logger.info(
      `Generate one with:  ssh-keygen -t ${algorithm} -f "${keyPath}"`
    );
    process.exit(1);
  }
  const defaultPath = join(sshDir, DEFAULT_KEY_NAME);
  if (fs.existsSync(defaultPath)) {
    Logger.info(`Using key: ${defaultPath}`);
    return defaultPath;
  }
  Logger.nl();
  Logger.warn(`No key found at ${defaultPath}.`);
  Logger.nl();
  const confirmed = await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(
      chalk.white(
        "  Would you like to generate a new ed25519 key pair now? (yes/no) "
      ),
      (ans) => {
        rl.close();
        resolve(/^y(es)?$/i.test(ans.trim()));
      }
    );
  });
  if (!confirmed) {
    Logger.nl();
    Logger.info("To generate a key manually, run:");
    Logger.print(chalk.yellow(`    ssh-keygen -t ed25519 -f "${defaultPath}"`));
    Logger.nl();
    Logger.info(
      `Then share the public key (${defaultPath}.pub) with your server admin.`
    );
    return void 0;
  }
  if (!fs.existsSync(sshDir))
    fs.mkdirSync(sshDir, { recursive: true, mode: 448 });
  Logger.nl();
  Logger.info("Generating ed25519 key pair...");
  const gen = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", defaultPath, "-N", ""],
    {
      stdio: "inherit"
    }
  );
  if (gen.status !== 0 || !fs.existsSync(defaultPath)) {
    Logger.error("Key generation failed.");
    process.exit(1);
  }
  Logger.success(`Key generated: ${defaultPath}`);
  showPublicKey(defaultPath);
  Logger.warn(
    "Share the public key above with your server admin before connecting."
  );
  await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(
      chalk.white(
        "  Press Enter once your key has been authorized, or Ctrl+C to cancel. "
      ),
      () => {
        rl.close();
        resolve();
      }
    );
  });
  return defaultPath;
}
function showPublicKey(privateKeyPath) {
  const pubPath = privateKeyPath + ".pub";
  if (!fs.existsSync(pubPath)) return;
  const pubKey = fs.readFileSync(pubPath, "utf8").trim();
  Logger.nl();
  Logger.print(chalk.white("  Your public key:"));
  Logger.divider(53);
  Logger.print(chalk.cyan(`  ${pubKey}`));
  Logger.divider(53);
  Logger.nl();
}
async function connectRemote(host, port, identity, command) {
  assertSshAvailable();
  const targetPort = port ?? REMOTE_PORT;
  const cleanHost = host.includes("@") ? host.slice(host.indexOf("@") + 1) : host;
  const keyPath = await ensureClientKey(identity);
  if (!keyPath) process.exit(0);
  if (!command || command.length === 0) {
    Logger.nl();
    Logger.info(`Connecting to ${cleanHost}:${targetPort} ...`);
    Logger.nl();
  }
  const sshArgs = [
    "-tt",
    // Force PTY allocation for proper ANSI handling
    "-p",
    String(targetPort),
    "-i",
    keyPath,
    "-o",
    "StrictHostKeyChecking=ask",
    "-o",
    "BatchMode=no",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    `dm@${cleanHost}`
  ];
  if (command && command.length > 0) {
    sshArgs.push(...command);
  }
  const result = spawnSync("ssh", sshArgs, { stdio: "inherit" });
  const exitCode = result.status ?? 1;
  if (exitCode === 255) {
    Logger.nl();
    Logger.error("Connection failed. Possible causes:");
    Logger.print(
      chalk.gray(`  - Server is not reachable at ${cleanHost}:${targetPort}`)
    );
    Logger.print(
      chalk.gray("  - Your public key is not authorized on the server")
    );
    Logger.nl();
    showPublicKey(keyPath);
    Logger.info(
      "Share the public key above with your server admin, then try again."
    );
    process.exit(1);
  }
  process.exit(exitCode);
}
export {
  connectRemote,
  ensureClientKey,
  showPublicKey
};
