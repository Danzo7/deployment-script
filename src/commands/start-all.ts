// start-all.ts

import path from "path";
import { AppRepo } from "../db/repos.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { getAppStatus, runApp } from "../utils/pm2-helper.js";
import { Logger } from "../utils/logger.js";


export async function startAllApplications() {
    for (const app of AppRepo.getAll()) {
        const appStatus = await getAppStatus(app.name);
        if (appStatus !== 'online') {
              const {  logDir } = ensureDirectories(app.appDir);
            const buildDir=app.builds?.[app.activeBuild??(app.builds.length-1)];
            if(!buildDir){
                Logger.warn(`No build found for ${app.name}`);
                continue;
            }
            else{
            await runApp(buildDir, {
                name: app.name,
                port: app.port,
                instances: app.instances,
                status: appStatus,
                output: path.join(logDir, 'pm2.out.log'),
                error: path.join(logDir, 'pm2.error.log'),
              });}
        } else {
            Logger.info(`${app.name} is already running.`);
        }
    }
}

// Run the function to start all applications
startAllApplications();