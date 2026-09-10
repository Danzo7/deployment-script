import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { Logger } from "./logger.js";
const runCommand = (command, options) => {
  const execOptions = {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    // capture stdout/stderr
    env: {
      ...process.env,
      CI: "true",
      NEXT_PRIVATE_SKIP_WARNINGS_IN_CI: "true",
      // ignore warnings as errors
      NEXT_TELEMETRY_DISABLED: "1"
      // disable telemetry
    },
    // ensure CI-friendly mode
    encoding: "utf8"
  };
  try {
    const stdout = execSync(command, execOptions);
    fs.appendFileSync(
      options.logFile,
      `Command: ${command}
Output:
${stdout}

`,
      "utf8"
    );
    return { code: 0, stdout: stdout?.toString(), stderr: null };
  } catch (err) {
    const errorMessage = err.stderr?.toString() || err.message;
    fs.appendFileSync(
      options.logFile,
      `Command: ${command}
Error:
${errorMessage}

`,
      "utf8"
    );
    return {
      code: err.status || 1,
      stdout: null,
      stderr: errorMessage
    };
  }
};
const runScript = async (dir, args, description, logFile) => {
  Logger.info(`${description}...`);
  const command = `npm run ${args}`;
  const result = runCommand(command, { cwd: dir, logFile });
  if (result.code !== 0) {
    throw new Error(`${description} failed: ${result.stderr}`);
  }
  Logger.info(`${description} completed successfully.`);
};
const installDependencies = async (dir, logFile) => {
  Logger.info("Installing packages...");
  const command = `npm install --no-audit --no-fund --yes`;
  const result = runCommand(command, { cwd: dir, logFile });
  if (result.code !== 0) {
    throw new Error(`Installation failed: ${result.stderr}`);
  }
  result.stdout?.split("\n").forEach(
    (line) => line.trim() == "" ? null : Logger.success(line)
  );
};
const prepare = async (dir, {
  withInstall = true,
  withBuild = true,
  withFix = false,
  logDir
}) => {
  Logger.info("Preparing...");
  try {
    const logFile = path.join(logDir, `prepare-${Date.now()}.log`);
    if (withInstall) {
      await installDependencies(dir, logFile);
    }
    if (withFix) {
      await runScript(dir, "fix", "lint fix", logFile);
    }
    if (withBuild) {
      await runScript(dir, "build", "build", logFile);
    }
    return true;
  } catch (error) {
    Logger.error(error);
    throw error;
  }
};
export {
  prepare
};
