import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { ensureDirectories } from '../utils/file-utils.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';
import { handleRepo, getLastRevision, pushVcsChanges, } from '../utils/vcs-helper.js';
import { pruneOldBuilds } from '../utils/build-pruner.js';
import { requireSymlinkPermission } from '../utils/os-helper.js';
import { getHandler } from '../app-types/index.js';
import { getCurrentUser } from '../utils/user-context.js';
export const deploy = async ({ name, force, lint, }) => {
    requireSymlinkPermission();
    const app = await AppRepo.findByNameWithConfigAndStorages(name);
    const isFirstDeploy = app.lastDeploy == undefined;
    const currentUser = getCurrentUser();
    if (!app.projectType) {
        await AppRepo.update(app.name, { projectType: 'nextjs' }, currentUser);
        app.projectType = 'nextjs';
    }
    Logger.info(`Deploying ${Logger.highlight(name)}...`);
    const handler = getHandler(app.projectType);
    const { relDir, envDir, logDir } = ensureDirectories(app.appDir);
    const buildRelDir = app.projectDir
        ? path.join(relDir, app.projectDir)
        : relDir;
    Logger.info('Checking repository...');
    await handleRepo(app, relDir);
    const currentRevision = await getLastRevision(app, relDir);
    const isRepoChanged = currentRevision?.hash !== app.lastDeployedCommit?.hash;
    Logger.info('Checking app status...');
    const appStatus = await getAppStatus(name);
    Logger.advice(`App Status: ${Logger.highlight(appStatus)}`);
    const isRunning = appStatus == 'online';
    Logger.info('Checking environment variables and config...');
    const isConfigChanged = await handler.syncConfig(buildRelDir, envDir);
    if (!isConfigChanged && !isRepoChanged && !isFirstDeploy) {
        Logger.info(`Everything is up to date`);
        if (isRunning) {
            Logger.info(`${Logger.highlight(name)} is already running on port ${Logger.highlight(app.port.toString())}.`);
            if (force) {
                Logger.info('Forcing redeploy...');
            }
            else
                return;
        }
    }
    await handler.prepareRelease(buildRelDir, {
        withDependencies: force || isFirstDeploy || isRepoChanged || !isRunning,
        withBuild: force || !isRunning || isFirstDeploy || isRepoChanged || isConfigChanged,
        withLint: lint,
        logDir,
        appName: app.name,
    });
    Logger.info('Creating build version...');
    const buildDir = handler.createBuildDir({
        appDir: app.appDir,
        projectDir: app.projectDir,
        storages: app.storages,
    });
    await runApp(buildDir, {
        name: app.name,
        port: app.port,
        status: appStatus,
        output: path.join(logDir, 'pm2.out.log'),
        error: path.join(logDir, 'pm2.error.log'),
        projectType: app.projectType,
        config: app.config,
    });
    if (handler.afterDeploy) {
        Logger.info('Running post-deploy hook...');
        await handler.afterDeploy({ appDir: app.appDir, port: app.port, appName: app.name });
    }
    await AppRepo.addBuild(name, buildDir, currentUser);
    if (currentRevision) {
        await AppRepo.updateDeployedCommit(name, currentRevision, currentUser);
    }
    await pruneOldBuilds(name);
    if (lint) {
        Logger.info('Pushing lint fix...');
        await pushVcsChanges(app, relDir, `[CLI Tool] Linting fix`);
    }
    Logger.success(`Successfully deployed ${Logger.highlight(name)} on port ${Logger.highlight(app.port.toString())}.`);
};
