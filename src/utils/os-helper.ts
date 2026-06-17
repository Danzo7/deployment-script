import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests whether the current process has permission to create symbolic links
 * by attempting to create a real symlink in a temp directory.
 */
export const canCreateSymlinks = (): boolean => {
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
    try { fs.unlinkSync(testLink); } catch { /* ignore */ }
    try { fs.rmdirSync(testTarget); } catch { /* ignore */ }
  }
};

const SYMLINK_ERROR_MESSAGE =
  'This command requires permission to create symbolic links.\n' +
  'On Windows, either:\n' +
  '  - Run this tool as Administrator, or\n' +
  '  - Enable Developer Mode (Settings → System → For developers → Developer Mode)';

/**
 * Throws an error with a user-friendly message if symlink creation is not permitted.
 * Call this at the top of any command that relies on symlinks.
 */
export const requireSymlinkPermission = (): void => {
  if (!canCreateSymlinks()) {
    throw new Error(SYMLINK_ERROR_MESSAGE);
  }
};
