import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { createWriteStream } from 'fs';
import { checkEnv, ensureDirectories } from '../utils/file-utils.js';
import { prepare } from '../utils/npm-helper.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';
import { handleGitRepo } from '../utils/git-helper.js';
export const saveLogs = (logDir: string) => {
  const stdoutLogStream = createWriteStream(path.join(logDir, "deploy.log"), {
    flags: "a", // Append to the log file instead of overwriting it
  });

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk) => {
    stdoutLogStream.write(chunk);
    originalStdoutWrite(chunk); // Write to console
    return true;
  };

  process.stderr.write = (chunk) => {
    stdoutLogStream.write(chunk);
    originalStderrWrite(chunk); // Write to console
    return true;
  };
  process.on("exit", () => {
    stdoutLogStream.end();
  });
};
export const deploy = async ({
  name,
  force,
  lint,
}: {
  name: string;
  lint?: boolean;
  force?: boolean;
}) => {
  Logger.info(`Starting deployment for ${Logger.highlight(name)}...`);

  const app = AppRepo.getAll().find((app) => app.name === name);
  const isFirstDeploy = app?.lastDeploy == undefined;
  if (!app) {
    throw new Error(
      `App "${Logger.highlight(name)}" not found in the repository.\n` +
      `To initialize the app, run: ${Logger.highlight(`dm init --name ${name} --repo <repo-url> --branch <branch-name> --instances <number-of-instances> --port <port-number>`)}`
    );
  }
  const { relDir, envDir, logDir } = ensureDirectories(app.appDir);
  saveLogs(logDir);
  Logger.info('Checking Git repository...');
  const isGitChanged = await handleGitRepo({
    dir: relDir,
    repo: app.repo,
    branch: app.branch,
  });

  Logger.info('Checking app status...');
  const appStatus = await getAppStatus(name);
  Logger.advice(`App Status: ${Logger.highlight(appStatus)}`);
  const isRunning = appStatus == 'online';

  Logger.info('Checking environment...');
  const isEnvChanged = await checkEnv(relDir, envDir);
  if (isEnvChanged && !isGitChanged && !isFirstDeploy) {
    Logger.info(`Everything is up to date`);
    if (isRunning) {
      Logger.info(
        `${Logger.highlight(name)} is already running on port ${Logger.highlight(app.port.toString())}.`
      );
      if (force) {
        Logger.info('Forcing restart...');
      } else return;
    }
  }

  await prepare(relDir, {
    withInstall: force || isFirstDeploy || isGitChanged || !isRunning,
    withBuild:
      force || !isRunning || isFirstDeploy || isGitChanged || !isEnvChanged,
    withFix: force || lint, // Add skip lint in future
  });
  await runApp(relDir, {
    name: app.name,
    port: app.port,
    instances: app.instances,
    status: appStatus,
    output: path.join(logDir, 'pm2.out.log'),
    error: path.join(logDir, 'pm2.error.log'),
  });
  AppRepo.updateLastDeploy(name);
  Logger.success(
    `Successfully deployed ${Logger.highlight(name)} on port ${Logger.highlight(app.port.toString())}.`
  );
};
