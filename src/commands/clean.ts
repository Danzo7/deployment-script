import { AppRepo } from "../db/repos.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { discardUncommittedChanges, handleGitRepo } from "../utils/git-helper.js";
import { Logger } from "../utils/logger.js";
import { pruneAllBuilds } from "../utils/build-pruner.js";

export const clean = async ({ name }: { name: string }) => {
  Logger.info(`Cleaning up app: ${name}...`);

  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) throw new Error("App not found");

  const { relDir } = ensureDirectories(app.appDir);

  try {
    Logger.isMuted = true;
    await handleGitRepo({ dir: relDir, repo: app.repo, branch: app.branch });
    Logger.isMuted = false;
    Logger.info(`Local git repo is already clean`);
  } catch {
    Logger.isMuted = false;
    discardUncommittedChanges(relDir);
  }

  await pruneAllBuilds(name);
};
