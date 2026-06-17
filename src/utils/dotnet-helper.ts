import { execSync, ExecSyncOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import { calculateFileHash } from './file-utils.js';
import { Logger } from './logger.js';

/**
 * Checks that the .NET SDK is installed. Warns at init time (no throw).
 */
export const checkDotnetInstalled = (): boolean => {
  try {
    execSync('dotnet --version', { stdio: 'pipe', encoding: 'utf8' });
    return true;
  } catch {
    Logger.warn(
      '.NET SDK is not installed or not on your PATH.\n' +
      '  → Install it from https://dotnet.microsoft.com/download\n' +
      "  → The app was registered but 'dm deploy' will fail until .NET is available."
    );
    return false;
  }
};

/**
 * Executes a shell command in a specified directory and logs output to a file.
 * @param command The command to execute.
 * @param options The options containing the working directory and log file path.
 * @returns An object with the command execution result.
 */
const runCommand = (command: string, options: { cwd: string; logFile: string }) => {
  const execOptions: ExecSyncOptions = {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    encoding: 'utf8',
  };

  try {
    const stdout = execSync(command, execOptions);

    fs.appendFileSync(
      options.logFile,
      `Command: ${command}\nOutput:\n${stdout}\n\n`,
      'utf8'
    );

    return { code: 0, stdout: stdout?.toString(), stderr: null };
  } catch (err: any) {
    const errorMessage = err.stderr?.toString() || err.message;
    fs.appendFileSync(options.logFile, `Command: ${command}\nError:\n${errorMessage}\n\n`, 'utf8');

    return {
      code: err.status || 1,
      stdout: null,
      stderr: errorMessage,
    };
  }
};

/**
 * Finds the first .csproj file in a directory.
 * @param relDir The directory to search in.
 * @returns The full path to the .csproj file, or null if not found.
 */
const findCsprojFile = (relDir: string): string | null => {
  const files = fs.readdirSync(relDir);
  const csproj = files.find((f) => f.endsWith('.csproj'));
  return csproj ? path.join(relDir, csproj) : null;
};

/**
 * Checks that the .NET SDK is installed and meets the version required by the project.
 * @param relDir The directory containing the .csproj file.
 */
export const checkDotnetSdk = async (relDir: string): Promise<void> => {
  // 1. Check that dotnet is installed
  let installedVersion: string;
  try {
    installedVersion = execSync('dotnet --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(
      "dotnet SDK not found. Install the .NET SDK from https://dotnet.microsoft.com/download and ensure 'dotnet' is on your PATH."
    );
  }

  // 2. Find .csproj
  const csprojPath = findCsprojFile(relDir);
  if (!csprojPath) {
    throw new Error(
      'No .csproj file found in the repository. Make sure your .NET project has a .csproj file at the repository root.'
    );
  }

  // 3. Parse <TargetFramework> from .csproj
  const csprojContent = fs.readFileSync(csprojPath, 'utf-8');
  const targetFrameworkMatch = csprojContent.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
  const targetFramework = targetFrameworkMatch?.[1] ?? '';

  // e.g. "net8.0" → major version 8
  const requiredMajorMatch = targetFramework.match(/net(\d+)/);
  const requiredMajor = requiredMajorMatch ? parseInt(requiredMajorMatch[1], 10) : null;

  // 4. Parse installed major version (e.g. "8.0.100" → 8)
  const installedMajor = parseInt(installedVersion.split('.')[0], 10);

  // 5. Compare versions
  if (requiredMajor !== null && installedMajor < requiredMajor) {
    throw new Error(
      `dotnet SDK version mismatch: project requires .NET ${requiredMajor} but found ${installedMajor}. Upgrade the SDK from https://dotnet.microsoft.com/download.`
    );
  }
};

/**
 * Checks that the assembly name in the .csproj matches the registered app name.
 * @param relDir The directory containing the .csproj file.
 * @param appName The registered application name.
 */
export const checkAssemblyName = async (relDir: string, appName: string): Promise<void> => {
  // 1. Find .csproj
  const csprojPath = findCsprojFile(relDir);
  if (!csprojPath) {
    throw new Error(
      'No .csproj file found in the repository. Make sure your .NET project has a .csproj file at the repository root.'
    );
  }

  // 2. Read content
  const csprojContent = fs.readFileSync(csprojPath, 'utf-8');

  // 3. Check for explicit <AssemblyName>
  const assemblyNameMatch = csprojContent.match(/<AssemblyName>([^<]+)<\/AssemblyName>/);

  if (assemblyNameMatch) {
    const foundName = assemblyNameMatch[1].trim();
    // 4. Throw if explicit <AssemblyName> doesn't match
    if (foundName !== appName) {
      throw new Error(
        `Assembly name mismatch: your .csproj declares <AssemblyName>${foundName}</AssemblyName>\n` +
        `but this dm app is registered as "${appName}".\n` +
        `\n` +
        `To fix this:\n` +
        `  1. Open your .csproj file and update the <AssemblyName> element:\n` +
        `         <AssemblyName>${appName}</AssemblyName>\n` +
        `  2. Commit and push the change to your repository.\n` +
        `  3. Run \`dm deploy ${appName}\` again.`
      );
    }
  } else {
    // 5. Fall back to .csproj filename stem
    const projectFile = path.basename(csprojPath, '.csproj');
    if (projectFile !== appName) {
      throw new Error(
        `Assembly name mismatch: your project file is "${projectFile}.csproj"\n` +
        `which will produce "${projectFile}.dll", but this dm app is registered as "${appName}".\n` +
        `\n` +
        `To fix this:\n` +
        `  1. Open your .csproj file and add <AssemblyName> inside <PropertyGroup>:\n` +
        `         <AssemblyName>${appName}</AssemblyName>\n` +
        `  2. Commit and push the change to your repository.\n` +
        `  3. Run \`dm deploy ${appName}\` again.`
      );
    }
  }
};

/**
 * Checks and synchronises appsettings files from the env directory to the release directory.
 * @param relDir The release directory (destination).
 * @param envDir The env directory (source).
 * @returns true if any file was copied, false otherwise.
 */
export const checkAppSettings = async (relDir: string, envDir: string): Promise<boolean> => {
  const settingsFiles = ['appsettings.json', 'appsettings.Production.json'];
  let anyChanged = false;
  let anyFoundInEnvDir = false;

  for (const fileName of settingsFiles) {
    const envFilePath = path.join(envDir, fileName);
    const relFilePath = path.join(relDir, fileName);

    if (!fs.existsSync(envFilePath)) {
      continue;
    }

    anyFoundInEnvDir = true;

    const envHash = calculateFileHash(envFilePath);
    const relHash = calculateFileHash(relFilePath); // returns '' if file doesn't exist

    if (envHash !== relHash) {
      fs.copyFileSync(envFilePath, relFilePath);
      Logger.success(`Updated ${fileName}`);
      anyChanged = true;
    } else {
      Logger.info(`${fileName} is up to date.`);
    }
  }

  if (!anyFoundInEnvDir) {
    Logger.info('No appsettings files found in env directory.');
    return false;
  }

  return anyChanged;
};

/**
 * Prepares a .NET project by running dotnet restore and dotnet publish.
 * @param dir The directory containing the project.
 * @param opts Options including the log directory.
 */
export const prepareDotnet = async (dir: string, opts: { logDir: string }): Promise<void> => {
  const logFile = path.join(opts.logDir, 'prepare-' + Date.now() + '.log');

  Logger.info('Running dotnet restore...');
  const restoreResult = runCommand('dotnet restore', { cwd: dir, logFile });
  if (restoreResult.code !== 0) {
    throw new Error(`dotnet restore failed: ${restoreResult.stderr}`);
  }

  Logger.info('Running dotnet publish...');
  const publishResult = runCommand('dotnet publish -c Release -o ./publish', { cwd: dir, logFile });
  if (publishResult.code !== 0) {
    throw new Error(`dotnet publish failed: ${publishResult.stderr}`);
  }
};
