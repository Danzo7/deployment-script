import fs from "fs";
import os from "os";
import path from "path";
const canCreateSymlinks = () => {
  const tmpDir = os.tmpdir();
  const testTarget = path.join(tmpDir, `symlink-test-target-${process.pid}`);
  const testLink = path.join(tmpDir, `symlink-test-link-${process.pid}`);
  try {
    fs.mkdirSync(testTarget, { recursive: true });
    fs.symlinkSync(testTarget, testLink);
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(testLink);
    } catch {
    }
    try {
      fs.rmdirSync(testTarget);
    } catch {
    }
  }
};
const SYMLINK_ERROR_MESSAGE = "This command requires permission to create symbolic links.\nOn Windows, either:\n  - Run this tool as Administrator, or\n  - Enable Developer Mode (Settings \u2192 System \u2192 For developers \u2192 Developer Mode)";
const requireSymlinkPermission = () => {
  if (!canCreateSymlinks()) {
    throw new Error(SYMLINK_ERROR_MESSAGE);
  }
};
export {
  canCreateSymlinks,
  requireSymlinkPermission
};
