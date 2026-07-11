// start-all.ts

import { AppRepo } from '../db/repos.js';
import { stopApp } from '../utils/pm2-helper.js';

export async function stopAllApplications() {
  const apps = await AppRepo.getAll();
  for (const app of apps) {
    await stopApp(app.name);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
