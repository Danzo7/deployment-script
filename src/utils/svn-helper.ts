import { execSync } from 'child_process';
import { Logger } from './logger.js';
import { withRetry } from './retry-helper.js';
import { isDirectoryEmpty } from './file-utils.js';

const MIN_SVN_MAJOR = 1;
const MIN_SVN_MINOR = 9;

/**
 * Verifies SVN is installed and meets the minimum version requirement.
 * @param throwOnMissing - throw an Error if SVN is missing/outdated (deploy); otherwise warn (init)
 */
export const checkSvn = (throwOnMissing = false): boolean => {
  let out: string | null = null;
  try {
    out = execSync('svn --version --quiet', {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  } catch {
    // not installed
  }

  if (!out) {
    const msg =
      `SVN is not installed or not on your PATH.\n` +
      `  → Install Subversion ${MIN_SVN_MAJOR}.${MIN_SVN_MINOR}+ from https://subversion.apache.org/packages.html`;
    if (throwOnMissing) throw new Error(msg);
    Logger.warn(msg);
    return false;
  }

  const match = out.match(/^(\d+)\.(\d+)/);
  if (match) {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const ok =
      major > MIN_SVN_MAJOR ||
      (major === MIN_SVN_MAJOR && minor >= MIN_SVN_MINOR);
    if (!ok) {
      const msg =
        `SVN ${out} is too old (minimum required: ${MIN_SVN_MAJOR}.${MIN_SVN_MINOR}).\n` +
        `  → Upgrade Subversion from https://subversion.apache.org/packages.html`;
      if (throwOnMissing) throw new Error(msg);
      Logger.warn(msg);
      return false;
    }
  }

  return true;
};

const svn = (cmd: string, cwd: string) =>
  execSync(`svn ${cmd}`, { cwd, stdio: 'pipe' }).toString().trim();

const isSvnWorkingCopy = (dir: string): boolean => {
  try {
    svn('info', dir);
    return true;
  } catch {
    return false;
  }
};

/**
 * Builds the full SVN URL from the repo base and branch path.
 * If branch is 'trunk' or starts with 'branches/' or 'tags/', it appends to repo.
 * Otherwise treats repo as the full URL.
 */
const buildSvnUrl = (repo: string, branch: string): string => {
  if (
    branch === 'trunk' ||
    branch.startsWith('branches/') ||
    branch.startsWith('tags/')
  ) {
    return `${repo.replace(/\/$/, '')}/${branch}`;
  }
  return repo; // repo is already the full URL
};

export const handleSvnRepo = async ({
  dir,
  repo,
  branch,
}: {
  dir: string;
  repo: string;
  branch: string;
}): Promise<boolean> => {
  checkSvn(true);
  const url = buildSvnUrl(repo, branch);

  const isWc = isSvnWorkingCopy(dir);

  if (!isWc && !isDirectoryEmpty(dir)) {
    throw new Error(
      `Please make sure the directory ${dir} is empty or is a valid SVN working copy.`
    );
  }

  if (!isWc) {
    Logger.info(`Checking out SVN repository ${url} into ${dir}`);
    await withRetry('Checking out SVN repository', async () =>
      svn(`checkout "${url}" "${dir}"`, process.cwd())
    );
    Logger.success('Repository checked out successfully.');
    return true;
  }

  // Get revision before update
  const revBefore = await withRetry('Getting SVN revision', async () =>
    svn('info --show-item revision', dir)
  );

  Logger.info('Updating SVN working copy...');
  await withRetry('Updating SVN working copy', async () => svn('update', dir));

  const revAfter = await withRetry(
    'Getting SVN revision after update',
    async () => svn('info --show-item revision', dir)
  );

  if (revBefore !== revAfter) {
    Logger.info(`Updated from r${revBefore} to r${revAfter}.`);
    return true;
  }

  Logger.info('SVN working copy is up-to-date. No changes detected.');
  return false;
};

export const getLastSvnRevision = async (
  dir: string
): Promise<{
  hash: string;
  message: string;
  author: string;
  date: string;
} | null> => {
  try {
    const output = svn('log --limit 1 --xml', dir);
    const revMatch = output.match(/revision="(\d+)"/);
    const authorMatch = output.match(/<author>(.*?)<\/author>/);
    const dateMatch = output.match(/<date>(.*?)<\/date>/);
    const msgMatch = output.match(/<msg>([\s\S]*?)<\/msg>/);

    if (!revMatch) return null;

    return {
      hash: `r${revMatch[1]}`,
      message: msgMatch?.[1]?.trim() ?? '',
      author: authorMatch?.[1] ?? '',
      date: dateMatch?.[1] ?? '',
    };
  } catch {
    return null;
  }
};

export const discardSvnChanges = async (dir: string): Promise<void> => {
  try {
    await withRetry('Reverting SVN changes', async () =>
      svn('revert -R .', dir)
    );
    Logger.success('SVN changes reverted.');
  } catch (error) {
    Logger.error('Failed to revert SVN changes.');
    throw error;
  }
};

export const relocateSvnRepo = async (
  dir: string,
  newUrl: string,
  branch: string
): Promise<void> => {
  checkSvn(true);
  const fullUrl = buildSvnUrl(newUrl, branch);

  try {
    Logger.info(`Relocating SVN repository to ${fullUrl}`);
    await withRetry('Relocating SVN repository', async () =>
      svn(`relocate "${fullUrl}"`, dir)
    );
    Logger.success(`SVN repository relocated successfully to ${fullUrl}`);
  } catch (error) {
    Logger.error('Failed to relocate SVN repository.');
    throw error;
  }
};
