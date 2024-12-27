import path from "path";
import { AppRepo } from "../db/repos.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { discardUncommittedChanges, handleGitRepo } from "../utils/git-helper.js";
import { Logger } from "../utils/logger.js";
import fsExtra from "fs-extra/esm";


export const clean =  async({
  name,

}: {
  name: string;
}) => {
  Logger.info(`Cleaning up app: ${name}...`);
  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) {
    throw new Error('App not found');
  }
  const { relDir } = ensureDirectories(app.appDir);

  try{
    Logger.isMuted=true;
await handleGitRepo({
    dir: relDir,
    repo: app.repo,
    branch: app.branch,
  })
  Logger.isMuted=false;
  Logger.info(`Local git repo is already clean`);
}
  catch{
     discardUncommittedChanges(relDir);
  }
  Logger.isMuted=false;
  Logger.info("Cleaning old builds...");
  const buildDir=path.join(app.appDir, 'builds');
  app.builds?.forEach((build, index)=>{
    if(index!==app.activeBuild){
    const buildPath=path.join(buildDir, build);
    Logger.info(`Removing build: ${build}`);
    fsExtra.removeSync(buildPath);
    AppRepo.removeBuild(name, build);
    }
  });
  

};
