import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import {  ensureDirectories } from '../utils/file-utils.js';
import { prepare } from '../utils/npm-helper.js';
import { getAppStatus, getProcessId, runApp } from '../utils/pm2-helper.js';
import {  handleGitRepo, pushChanges } from '../utils/git-helper.js';
import { checkEnv } from '../utils/env-heper.js';

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

  Logger.info('Checking environment variables...');
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
      force || !isRunning || isFirstDeploy || isGitChanged || isEnvChanged,
    withFix:  lint, // Add skip lint in future
    logDir 
  });
  let pId=await getProcessId(name);
  Logger.info("Old Process ID: "+pId);
  await runApp(relDir, {
    name: app.name,
    port: app.port,
    instances: app.instances,
    status: appStatus,
    output: path.join(logDir, 'pm2.out.log'),
    error: path.join(logDir, 'pm2.error.log'),
  },force);
  pId=await getProcessId(name);
  Logger.info("New Process ID: "+pId);
  AppRepo.updateLastDeploy(name);
  if(lint){
    Logger.info('Pushing lint fix...');
   await pushChanges({dir:relDir, commitMessage:`[CLI Tool] Linting fix`});
  }
  Logger.success(
    `Successfully deployed ${Logger.highlight(name)} on port ${Logger.highlight(app.port.toString())}.`
  );
};
