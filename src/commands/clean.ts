import { AppRepo } from "../db/repos.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { handleRepo, discardLocalChanges } from "../utils/vcs-helper.js";
import { Logger } from "../utils/logger.js";
import { pruneAllBuilds } from "../utils/build-pruner.js";

export const clean = async ({ name }: { name: string }) => {
  Logger.info(`Cleaning up app: ${name}...`);

  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) throw new Error("App not found");

  const { relDir } = ensureDirectories(app.appDir);

  try {
    Logger.isMuted = true;
    await handleRepo(app, relDir);
    Logger.isMuted = false;
    Logger.info(`Local repository is already clean`);
  } catch {
    Logger.isMuted = false;
    await discardLocalChanges(app, relDir);
  }

  await pruneAllBuilds(name);
};
