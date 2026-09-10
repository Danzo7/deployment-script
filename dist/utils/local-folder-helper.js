import fs from "fs";
import path from "path";
import { Logger } from "./logger.js";
const checkLocalFolder = (repo) => {
  if (!fs.existsSync(repo))
    throw new Error(`Local source folder not found: ${repo}`);
  if (!fs.statSync(repo).isDirectory())
    throw new Error(`Local source path is not a directory: ${repo}`);
};
const handleLocalFolder = async ({
  dir,
  repo
}) => {
  if (!fs.existsSync(repo)) {
    throw new Error(`Local source folder not found: ${repo}`);
  }
  const stat = fs.statSync(repo);
  if (!stat.isDirectory()) {
    throw new Error(`Local source path is not a directory: ${repo}`);
  }
  const existed = fs.existsSync(dir);
  const srcMtime = getLatestMtime(repo);
  let prevMtime = null;
  if (existed) {
    const marker = path.join(dir, ".local-source-mtime");
    if (fs.existsSync(marker)) {
      prevMtime = parseInt(fs.readFileSync(marker, "utf8").trim(), 10);
    }
  }
  if (prevMtime !== null && prevMtime === srcMtime) {
    Logger.info("Local folder is up-to-date. No changes detected.");
    return false;
  }
  Logger.info(`Copying local folder ${repo} \u2192 ${dir}`);
  if (existed) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  copyDirSync(repo, dir);
  fs.writeFileSync(path.join(dir, ".local-source-mtime"), String(srcMtime));
  Logger.success("Local folder copied successfully.");
  return true;
};
const getLocalFolderRevision = (repo) => {
  if (!fs.existsSync(repo)) return null;
  const mtime = getLatestMtime(repo);
  const date = new Date(mtime);
  return {
    hash: String(mtime).slice(-7),
    // last 7 digits of epoch ms → stable short id
    message: "local folder snapshot",
    author: "local",
    date: date.toISOString()
  };
};
function copyDirSync(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
function getLatestMtime(dir) {
  let latest = fs.statSync(dir).mtimeMs;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, getLatestMtime(full));
    } else {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}
export {
  checkLocalFolder,
  getLocalFolderRevision,
  handleLocalFolder
};
