import fs from "fs";
import path from "path";
import fsExtra from "fs-extra";
import Table from "cli-table3";
import chalk from "chalk";
import { formatDate } from "../utils/date-helper.js";
import { STORAGE_DIR } from "../constants.js";
import { AppRepo, StorageRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import { requireSymlinkPermission } from "../utils/os-helper.js";
import { getCurrentUser } from "../utils/user-context.js";
const storageNew = async (name, linkName) => {
  const storagePath = path.join(STORAGE_DIR, name);
  fs.mkdirSync(storagePath, { recursive: true });
  await StorageRepo.add({
    name,
    linkName: linkName ?? null,
    path: storagePath
  }, getCurrentUser());
  const effectiveLinkName = linkName ?? name;
  Logger.success(
    `Storage ${Logger.highlight(name)} created at ${Logger.highlight(storagePath)} (symlink name: ${Logger.highlight(effectiveLinkName)}).`
  );
};
const storageAttach = async (appName, storageName) => {
  requireSymlinkPermission();
  const app = await AppRepo.findByName(appName);
  const storage = await StorageRepo.findByName(storageName);
  const existingStorages = await AppRepo.getStoragesByAppId(app.id);
  if (existingStorages.some((s) => s.id === storage.id)) {
    throw new Error(
      `Storage "${storageName}" is already attached to "${appName}"`
    );
  }
  if (app.activeBuild) {
    let activeBuildExists = false;
    try {
      fs.lstatSync(app.activeBuild);
      activeBuildExists = true;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (activeBuildExists) {
      const effectiveLinkName = storage.linkName ?? storage.name;
      const symlinkPath = path.join(app.activeBuild, effectiveLinkName);
      let stat = null;
      try {
        stat = fs.lstatSync(symlinkPath);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      if (stat !== null) {
        if (stat.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(symlinkPath);
          if (currentTarget !== storage.path) {
            throw new Error(
              `Cannot attach: a symlink "${effectiveLinkName}" already exists in the active build pointing to a different target ("${currentTarget}").`
            );
          }
        } else {
          throw new Error(
            `Cannot attach: a real directory "${effectiveLinkName}" already exists in the active build. Remove or rename it first.`
          );
        }
      }
    }
  }
  await AppRepo.linkStorage(app.id, storage.id);
  if (app.activeBuild) {
    let activeBuildExists = false;
    try {
      fs.lstatSync(app.activeBuild);
      activeBuildExists = true;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (activeBuildExists) {
      const effectiveLinkName = storage.linkName ?? storage.name;
      const symlinkPath = path.join(app.activeBuild, effectiveLinkName);
      let symlinkExists = false;
      try {
        const existingStat = fs.lstatSync(symlinkPath);
        if (existingStat.isSymbolicLink() && fs.readlinkSync(symlinkPath) === storage.path) {
          symlinkExists = true;
        }
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      if (!symlinkExists) {
        fs.mkdirSync(storage.path, { recursive: true });
        fs.symlinkSync(storage.path, symlinkPath);
      }
    }
  }
  Logger.success(
    `Storage ${Logger.highlight(storageName)} attached to ${Logger.highlight(appName)} as ${Logger.highlight(storage.linkName ?? storage.name)}.`
  );
};
const storageDetach = async (appName, storageName) => {
  const app = await AppRepo.findByName(appName);
  const storage = await StorageRepo.findByName(storageName);
  const existingStorages = await AppRepo.getStoragesByAppId(app.id);
  if (!existingStorages.some((s) => s.id === storage.id)) {
    throw new Error(`Storage "${storageName}" is not attached to "${appName}"`);
  }
  await AppRepo.unlinkStorage(app.id, storage.id);
  if (app.activeBuild) {
    const effectiveLinkName = storage.linkName ?? storage.name;
    const symlinkPath = path.join(app.activeBuild, effectiveLinkName);
    try {
      fs.lstatSync(symlinkPath);
      fs.unlinkSync(symlinkPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  Logger.success(
    `Storage ${Logger.highlight(storageName)} detached from ${Logger.highlight(appName)}.`
  );
};
const storageRm = async (name) => {
  const storage = await StorageRepo.findByName(name);
  const attachedApps = await AppRepo.findByStorageId(storage.id);
  if (attachedApps.length > 0) {
    const appNames = attachedApps.map((app) => app.name);
    throw new Error(
      `Storage "${name}" is still attached to the following apps: ${appNames.join(", ")}. Detach it from all apps before removing.`
    );
  }
  await StorageRepo.remove(name);
  const storagePath = path.join(STORAGE_DIR, name);
  if (fs.existsSync(storagePath)) {
    await fsExtra.remove(storagePath);
  } else {
    Logger.info(
      `Storage directory ${Logger.highlight(storagePath)} not found on disk; skipping removal.`
    );
  }
  Logger.success(`Storage ${Logger.highlight(name)} removed.`);
};
const getDirectorySize = (dirPath) => {
  try {
    fs.statSync(dirPath);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(fullPath).size;
      } catch {
      }
    }
  }
  return total;
};
const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
const storageLs = async () => {
  const storages = await StorageRepo.getAllWithApps();
  if (storages.length === 0) {
    Logger.info("No storages have been created");
    return;
  }
  let totalBytes = 0;
  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.whiteBright("Name"),
      chalk.blue("Link Name"),
      chalk.magenta("Path"),
      chalk.yellow("Created"),
      chalk.whiteBright("Apps"),
      chalk.green("Size")
    ]
  });
  storages.forEach((storage, index) => {
    const sizeBytes = getDirectorySize(storage.path);
    totalBytes += sizeBytes;
    const attachedApps = storage.apps.map((app) => app.name);
    const attachedAppsDisplay = attachedApps.length > 0 ? chalk.whiteBright(attachedApps.join(", ")) : chalk.gray("\u2014");
    const createdAt = formatDate(storage.createdAt, "N/A");
    table.push([
      chalk.cyan(index + 1),
      chalk.whiteBright(storage.name),
      chalk.blue(storage.linkName ?? storage.name),
      chalk.magenta(storage.path),
      chalk.yellow(createdAt),
      attachedAppsDisplay,
      chalk.green(formatSize(sizeBytes))
    ]);
  });
  table.push([
    { colSpan: 6, content: chalk.gray("Total"), hAlign: "right" },
    chalk.green(formatSize(totalBytes))
  ]);
  Logger.table(table.toString());
};
export {
  formatSize,
  getDirectorySize,
  storageAttach,
  storageDetach,
  storageLs,
  storageNew,
  storageRm
};
