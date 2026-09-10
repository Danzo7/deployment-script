import fs from "fs";
import path from "path";
import fsExtra from "fs-extra";
import { AppRepo } from "../db/repos.js";
import { Logger } from "./logger.js";
import { withBackoffRetry } from "./retry-helper.js";
import { STORAGE_DIR } from "../constants.js";
const MAX_BUILDS = 3;
const removeBuildDir = async (buildPath) => {
  const symlink = path.join(buildPath, "node_modules");
  if (fs.existsSync(symlink)) {
    try {
      fs.unlinkSync(symlink);
    } catch {
    }
  }
  if (fs.existsSync(buildPath)) {
    let entries = [];
    try {
      entries = fs.readdirSync(buildPath, { withFileTypes: true });
    } catch {
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const entryPath = path.join(buildPath, entry.name);
        try {
          const target = fs.realpathSync(entryPath);
          if (target.startsWith(STORAGE_DIR)) {
            fs.unlinkSync(entryPath);
          }
        } catch (err) {
          Logger.warn(
            `Could not remove storage symlink "${entry.name}" in build "${path.basename(buildPath)}": ${err}`
          );
        }
      }
    }
  }
  await withBackoffRetry(
    `Remove ${path.basename(buildPath)}`,
    () => fsExtra.remove(buildPath),
    5,
    2e3
  );
};
const removeBuilds = async (appName, buildPaths) => {
  if (buildPaths.length === 0) return;
  Logger.info(`Removing ${buildPaths.length} old build(s) for "${appName}"...`);
  for (const buildPath of buildPaths) {
    try {
      await Logger.spinner(
        `Removing old build: ${path.basename(buildPath)}`,
        () => removeBuildDir(buildPath)
      );
      await AppRepo.removeBuild(appName, buildPath);
    } catch {
      Logger.warn(
        `Could not remove "${path.basename(buildPath)}" \u2014 skipping. Run ${Logger.command("dm clean")} to retry.`
      );
    }
  }
};
const pruneOldBuilds = async (appName) => {
  const app = await AppRepo.findByName(appName);
  if (!app?.builds || app.builds.length <= MAX_BUILDS) return;
  const buildsToRemove = app.builds.map((buildPath, index) => ({ buildPath, index })).filter(({ buildPath }) => buildPath !== app.activeBuild).slice(0, app.builds.length - MAX_BUILDS);
  await removeBuilds(
    appName,
    buildsToRemove.map((b) => b.buildPath)
  );
};
const pruneAllBuilds = async (appName) => {
  const app = await AppRepo.findByName(appName);
  if (!app?.builds || app.builds.length === 0) {
    Logger.info("No old builds to clean.");
    return;
  }
  const buildsToRemove = app.builds.map((buildPath, index) => ({ buildPath, index })).filter(({ buildPath }) => buildPath !== app.activeBuild).map((b) => b.buildPath);
  if (buildsToRemove.length === 0) {
    Logger.info("No old builds to clean.");
    return;
  }
  await removeBuilds(appName, buildsToRemove);
};
export {
  pruneAllBuilds,
  pruneOldBuilds
};
