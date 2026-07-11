import fsExtra from 'fs-extra/esm';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { deletePm2App, getAppStatus } from '../utils/pm2-helper.js';

export const Delete = async ({ name }: { name: string }) => {
  Logger.info(`Deleting app: ${name}...`);
  const app = await AppRepo.findByName(name);
  const appStatus = await getAppStatus(name);
  if (appStatus !== 'not-found') {
    await deletePm2App(name);
  }
  //delete appDir directory
  fsExtra.removeSync(app.appDir);
  await AppRepo.remove(name);
  Logger.success(`App ${name} deleted successfully.`);
};
