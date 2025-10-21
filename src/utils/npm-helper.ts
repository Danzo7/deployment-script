import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js';

/**
 * Executes a shell command in a specified directory and logs output to a file.
 * @param command The command to execute.
 * @param options The options containing the working directory and log file path.
 * @returns An object with the command execution result.
 */
const runCommand = (command: string, options: { cwd: string; logFile: string }) => {
  try {
    // Ensure log directory exists
    fs.mkdirSync(path.dirname(options.logFile), { recursive: true });

    const result = execSync(command, {
      cwd: options.cwd,
      stdio: 'pipe',
      env: { ...process.env, CI: 'true' },
    }).toString();

    fs.appendFileSync(options.logFile, `Command: ${command}\nOutput:\n${result}\n\n`, 'utf8');
    return { code: 0, stdout: result, stderr: null };
  } catch (err: any) {
    const stderr = err.stderr?.toString() ?? '';
    const stdout = err.stdout?.toString() ?? '';
    const status = err.status ?? 1;

    // Determine if stderr contains only harmless npm warnings
    const hasError = /npm ERR!/i.test(stderr);
    const hasOnlyWarnings = !hasError && /npm WARN/i.test(stderr);

    // If it's just warnings, treat as success
    if (hasOnlyWarnings || status === 0) {
      fs.appendFileSync(options.logFile, `Command: ${command}\nWarning:\n${stderr}\n\n`, 'utf8');
      return { code: 0, stdout, stderr };
    }

    // Otherwise treat as a real error
    fs.appendFileSync(options.logFile, `Command: ${command}\nError:\n${stderr}\n\n`, 'utf8');
    return { code: status, stdout, stderr };
  }
};

/**
 * Runs a specified npm script in a directory and logs output to a file.
 * @param dir The directory to execute the script in.
 * @param args The npm script to run.
 * @param description A description of the script being run.
 * @param logFile The log file path.
 */
const runScript = async (dir: string, args: string, description: string, logFile: string) => {
  Logger.info(`${description}...`);
    const command = `npm run ${args}`;
    const result = runCommand(command, { cwd: dir, logFile });

    if (result.code !== 0) {
      throw new Error(`${description} failed: ${result.stderr}`);
    }

    Logger.info(`${description} completed successfully.`);
 
};

/**
 * Installs npm dependencies in a specified directory and logs output to a file.
 * @param dir The directory to install dependencies in.
 * @param logFile The log file path.
 */
const installDependencies = async (dir: string, logFile: string) => {
  Logger.info('Installing packages...');
    const command = `npm install --no-audit --no-fund --yes`;
    const result = runCommand(command, { cwd: dir, logFile });

    if (result.code !== 0) {
      throw new Error(`Installation failed: ${result.stderr}`);
    }

    result.stdout?.split('\n').forEach((line:string) =>line.trim()==''?null: Logger.success(line));
  
};

/**
 * Prepares a project by installing dependencies, fixing lint issues, and building the project.
 * @param dir The directory to prepare.
 * @param options Preparation options (install, fix, build, and log folder).
 * @returns A promise that resolves when preparation is complete.
 */
export const prepare = async (
  dir: string,
  {
    withInstall = true,
    withBuild = true,
    withFix = false,
    logDir,
  }: {
    withInstall?: boolean;
    withBuild?: boolean;
    withFix?: boolean;
    logDir: string;
  }
) => {
  Logger.info('Preparing...');
  try {
    const logFile = path.join(logDir, `prepare-${Date.now()}.log`);

    if (withInstall) {
      await installDependencies(dir, logFile);
    }

    if (withFix) {
      await runScript(dir, 'fix', 'lint fix', logFile);
    }

    if (withBuild) {
      await runScript(dir, 'build', 'build', logFile);
    }

    return true;
  } catch (error) {
    Logger.error(error);
    throw error;
  }
};
