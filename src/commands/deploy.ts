import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import {
  createBuildDirByType,
  ensureDirectories,
  hasPackageJson,
} from '../utils/file-utils.js';
import { prepare } from '../utils/npm-helper.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';
import {
  handleRepo,
  getLastRevision,
  pushVcsChanges,
} from '../utils/vcs-helper.js';
import { checkEnv } from '../utils/env-heper.js';
import {
  checkDotnetSdk,
  ensureAssemblyName,
  checkAppSettings,
  prepareDotnet,
} from '../utils/dotnet-helper.js';
import { pruneOldBuilds } from '../utils/build-pruner.js';
import { requireSymlinkPermission } from '../utils/os-helper.js';

export const deploy = async ({
  name,
  force,
  lint,
}: {
  name: string;
  lint?: boolean;
  force?: boolean;
}) => {
  requireSymlinkPermission();

  const app = await AppRepo.findByNameWithStorages(name);
  const isFirstDeploy = app.lastDeploy == undefined;
  if (!app.projectType) {
    await AppRepo.update(app.name, { projectType: 'nextjs' });
    app.projectType = 'nextjs';
  }
  Logger.info(`Deploying ${Logger.highlight(name)}...`);

  const { relDir, envDir, logDir } = ensureDirectories(app.appDir);
  const buildRelDir = app.projectDir
    ? path.join(relDir, app.projectDir)
    : relDir;
  Logger.info('Checking repository...');
  await handleRepo(app, relDir);
  const currentRevision = await getLastRevision(app, relDir);
  const isGitChanged = currentRevision?.hash !== app.lastDeployedCommit?.hash;

  Logger.info('Checking app status...');
  const appStatus = await getAppStatus(name);
  Logger.advice(`App Status: ${Logger.highlight(appStatus)}`);
  const isRunning = appStatus == 'online';

  Logger.info('Checking environment variables...');
  const isEnvChanged =
    app.projectType === 'static'
      ? false
      : await checkEnv(
          buildRelDir,
          envDir,
          app.projectType === 'nextjs' ? '.env.local' : '.env'
        );

  let isAppSettingsChanged = false;
  if (app.projectType === 'dotnet') {
    await checkDotnetSdk(buildRelDir);
    await ensureAssemblyName(buildRelDir, app.name);
    isAppSettingsChanged = await checkAppSettings(buildRelDir, envDir);
  }

  if (
    !isEnvChanged &&
    !isAppSettingsChanged &&
    !isGitChanged &&
    !isFirstDeploy
  ) {
    Logger.info(`Everything is up to date`);
    if (isRunning) {
      Logger.info(
        `${Logger.highlight(name)} is already running on port ${Logger.highlight(app.port.toString())}.`
      );
      if (force) {
        Logger.info('Forcing redeploy...');
      } else return;
    }
  }

  if (app.projectType === 'dotnet') {
    await prepareDotnet(buildRelDir, { logDir });
  } else if (app.projectType === 'static') {
    if (hasPackageJson(buildRelDir)) {
      throw new Error(
        `Static apps with a package.json build step are not yet supported.\n` +
          `Commit the pre-built output (dist/ or build/) to your repository and redeploy.`
      );
    }
    // No package.json — pure static files, nothing to prepare
  } else {
    await prepare(buildRelDir, {
      withInstall: force || isFirstDeploy || isGitChanged || !isRunning,
      withBuild:
        force || !isRunning || isFirstDeploy || isGitChanged || isEnvChanged,
      withFix: lint,
      logDir,
    });
  }
  Logger.info('Creating build version...');

  const buildDir = createBuildDirByType(
    app.appDir,
    app.projectType,
    app.projectDir,
    app.storages
  );
  await runApp(buildDir, {
    name: app.name,
    port: app.port,
    instances: app.instances,
    status: appStatus,
    output: path.join(logDir, 'pm2.out.log'),
    error: path.join(logDir, 'pm2.error.log'),
    projectType: app.projectType,
  });
  await AppRepo.addBuild(name, buildDir);
  if (currentRevision) {
    await AppRepo.updateDeployedCommit(name, currentRevision);
  }
  await pruneOldBuilds(name);
  if (lint) {
    Logger.info('Pushing lint fix...');
    await pushVcsChanges(app, relDir, `[CLI Tool] Linting fix`);
  }
  Logger.success(
    `Successfully deployed ${Logger.highlight(name)} on port ${Logger.highlight(app.port.toString())}.`
  );
};
