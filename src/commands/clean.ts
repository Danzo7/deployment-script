import { AppRepo } from "../db/repos.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { discardUncommittedChanges, handleGitRepo } from "../utils/git-helper.js";
import { Logger } from "../utils/logger.js";


export const clean =  async({
  name,

}: {
  name: string;
}) => {
  Logger.info(`Cleaning up from local changes...`);
  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) {
    throw new Error('App not found');
  }
  const { relDir } = ensureDirectories(app.appDir);

  try{
    const isChanged=await handleGitRepo({
    dir: relDir,
    repo: app.repo,
    branch: app.branch,
  })
  Logger.info(`Local directory is already clean, ${isChanged?'with uncoming changes':'and up to date'}.`);
}
  catch{
     discardUncommittedChanges(relDir);
  }

};
