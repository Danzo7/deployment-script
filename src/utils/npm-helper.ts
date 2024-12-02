import { execSync } from 'child_process';
import { Logger } from './logger.js';

const runCommand = (command: string, options: { cwd: string }) => {
  try {
    const result = execSync(command, {
      cwd: options.cwd,
      stdio: 'pipe',
      windowsHide: true,
    }).toString();
    return { code: 0, stdout: result, stderr: null };
  } catch (err: any) {
    return { code: err.status || 1, stdout: null, stderr: err.stderr?.toString() || err.message };
  }
};

const runNextScript = async (dir: string, args: string, description: string) => {
  Logger.info(`${description}...`);
  try {
    const command = `npx next ${args}`;
    const result = runCommand(command, { cwd: dir });

    if (result.code !== 0) {
      Logger.error(`${description} failed: ${result.stderr}`);
      throw new Error(`${description} failed: ${result.stderr}`);
    }

    Logger.info(`${description} completed successfully.`);
    Logger.info(result.stdout);
  } catch (err) {
    Logger.error(`${description} failed: ${err}`);
    throw err;
  }
};

const installDependencies = async (dir: string) => {
  Logger.info('Installing packages using npm...');
  try {
    const command = `npm install`;
    const result = runCommand(command, { cwd: dir });

    if (result.code !== 0) {
      Logger.error(`Installation failed: ${result.stderr}`);
      throw new Error(`Installation failed: ${result.stderr}`);
    }

    Logger.success('Packages installed successfully.');
    Logger.info(result.stdout);
  } catch (error) {
    Logger.error(`Installation failed: ${error}`);
    throw error;
  }
};

export const prepare = async (
  dir: string,
  { withInstall = true, withBuild = true, withFix = true }: { withInstall?: boolean; withBuild?: boolean; withFix?: boolean }
) => {
  Logger.info('Preparing');
  try {
    if (withInstall) {
      await installDependencies(dir);
    }

    if (withFix) {
      await runNextScript(dir, 'lint --fix', 'Running lint fix');
    }

    if (withBuild) {
      await runNextScript(dir, 'build', 'Running build');
    }

    return true;
  } catch (error) {
    Logger.error(error);
    throw error;
  }
};