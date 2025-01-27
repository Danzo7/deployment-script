// start-all.ts

import { AppRepo } from "../db/repos.js";
import {  stopApp } from "../utils/pm2-helper.js";


export async function stopAllApplications() {
    for (const app of AppRepo.getAll()) {
            await stopApp(app.name);
            await new Promise((resolve)=>setTimeout(resolve,1000)); 
    }
}

