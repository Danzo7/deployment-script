import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { ensureDirectories } from '../utils/file-utils.js';
import { getAppStatus, stopApp, flushApp, runApp } from '../utils/pm2-helper.js';
async function clearLogsForProcess(app) {
    const status = await getAppStatus(app.name);
    const wasRunning = status === 'online' || status === 'launching';
    if (wasRunning) {
        Logger.info(`Stopping "${Logger.highlight(app.name)}" before clearing logs...`);
        await stopApp(app.name);
    }
    await flushApp(app.name);
    if (wasRunning) {
        const buildDir = await AppRepo.resolveActiveBuild(app.name);
        if (buildDir) {
            const { logDir } = ensureDirectories(app.appDir);
            await runApp(buildDir, {
                name: app.name,
                port: app.port,
                status,
                output: path.join(logDir, 'pm2.out.log'),
                error: path.join(logDir, 'pm2.error.log'),
                projectType: app.projectType,
                config: app.config,
            });
        }
    }
}
export const logClear = async ({ name, all, }) => {
    if (all) {
        const apps = await AppRepo.getAll();
        for (const app of apps) {
            const appWithConfig = await AppRepo.findByNameWithConfig(app.name);
            await clearLogsForProcess(appWithConfig);
            Logger.info(`Cleared logs for "${Logger.highlight(app.name)}"`);
        }
        Logger.info('All app logs cleared.');
    }
    else {
        if (!name)
            throw new Error('Provide an app <name> or use --all to clear all logs.');
        const app = await AppRepo.findByNameWithConfig(name);
        await clearLogsForProcess(app);
        Logger.info(`Logs cleared for "${Logger.highlight(name)}".`);
    }
};
