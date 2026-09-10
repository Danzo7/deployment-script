import { AppRepo } from "../db/repos.js";
import { stopApp } from "../utils/pm2-helper.js";
async function stopAllApplications() {
  const apps = await AppRepo.getAll();
  for (const app of apps) {
    await stopApp(app.name);
    await new Promise((resolve) => setTimeout(resolve, 1e3));
  }
}
export {
  stopAllApplications
};
