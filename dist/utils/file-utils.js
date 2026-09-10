import { createHash } from "crypto";
import { Logger } from "./logger.js";
import fs from "fs";
import path from "path";
const calculateFileHash = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  const fileContent = fs.readFileSync(filePath, "utf-8");
  return createHash("sha256").update(fileContent).digest("hex");
};
const isDirectoryEmpty = (dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
const ensureDirectories = (appDir) => {
  const relDir = path.join(appDir, "release");
  const envDir = path.join(appDir, "env");
  const logDir = path.join(appDir, "logs");
  Logger.info(`Checking directories...`);
  if (!fs.existsSync(relDir)) {
    fs.mkdirSync(relDir, { recursive: true });
    Logger.success(`Created directory ${relDir}`);
  }
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
    Logger.success(`created directory ${envDir}`);
  }
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    Logger.success(`created directory ${logDir}`);
  }
  return { relDir, envDir, logDir };
};
const hasPackageJson = (dir) => fs.existsSync(path.join(dir, "package.json"));
const applyStorageSymlinks = (buildDir, storages = []) => {
  for (const storage of storages) {
    const effectiveLinkName = storage.linkName ?? storage.name;
    const linkPath = path.join(buildDir, effectiveLinkName);
    const targetPath = storage.path;
    let stat = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        Logger.warn(
          `applyStorageSymlinks: could not stat "${linkPath}": ${err.message}`
        );
        continue;
      }
    }
    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(linkPath);
        if (existingTarget === targetPath) {
          continue;
        } else {
          Logger.error(
            `applyStorageSymlinks: stale symlink at "${linkPath}" points to "${existingTarget}" instead of "${targetPath}". Skipping.`
          );
          continue;
        }
      } else {
        Logger.warn(
          `applyStorageSymlinks: a real file or directory already exists at "${linkPath}" (storage: "${storage.name}"). Skipping.`
        );
        continue;
      }
    }
    fs.mkdirSync(targetPath, { recursive: true });
    fs.symlinkSync(targetPath, linkPath);
    Logger.success(
      `Linked storage "${storage.name}" (${effectiveLinkName}) \u2192 "${targetPath}"`
    );
  }
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
export {
  applyStorageSymlinks,
  calculateFileHash,
  ensureDirectories,
  formatSize,
  getDirectorySize,
  hasPackageJson,
  isDirectoryEmpty
};
