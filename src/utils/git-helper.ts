import { simpleGit, CheckRepoActions, ResetMode } from 'simple-git';
import { Logger } from './logger.js';
import { withRetry } from './retry-helper.js';
import { isDirectoryEmpty } from './file-utils.js';

export const handleGitRepo = async ({
  dir,
  repo,
  branch,
}: {
  dir: string;
  repo: string;
  branch: string;
}) => {
  const git = simpleGit(dir);

  const isGitRepo = await withRetry('Checking Git status', () =>
    git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
  );
  if (!isGitRepo && !isDirectoryEmpty(dir)) {
    throw new Error(
      `Please Make sure the directory ${dir} is empty or is a valid git repository.`
    );
  }
  if (!isGitRepo) {
    Logger.info(`Cloning repository ${repo} (branch: ${branch}) into ${dir}`);
    await withRetry('Cloning repository', async () =>
      git.clone(repo, dir, ['--branch', branch])
    );
    Logger.success(`Repository cloned successfully.`);
    return true;
  }

  await withRetry('Fetching repository updates', async () => git.fetch());
  const status = await withRetry('Getting repository status', async () =>
    git.status()
  );

  if (status.ahead > 0) {
    Logger.warn(`${status.ahead} commits ahead. Resetting to remote...`);
    await withRetry('Resetting to remote', async () =>
      git.reset(['--hard', `origin/${status.current}`])
    );
  }

  // Re-fetch status after potential reset so behind count is accurate
  const freshStatus = await withRetry('Getting updated repository status', async () =>
    git.status()
  );

  if (freshStatus.behind > 0) {
    Logger.info(`${freshStatus.behind} new commits found. Pulling changes...`);
    await withRetry('Pulling changes', async () => git.pull());
    return true;
  }

  Logger.info('Repository is up-to-date. No changes detected.');
  return false;
};
export const pushChanges = async ({
  dir,
  commitMessage,
}: {
  dir: string;
  commitMessage: string;
}) => {
  const git = simpleGit(dir);
  const status = await withRetry('Getting repository status', async () =>
    git.status()
  );

    if(status.behind > 0) {
      throw new Error('Cannot push changes. The repository is not up-to-date.');
    }

  try {
    // Stage changes (all files)
    Logger.info('Staging changes...');
    await withRetry('Staging changes', async () => git.add('.'));

    // Commit changes
    Logger.info('Committing changes...');
    await withRetry('Committing changes', async () =>
      git.commit(commitMessage)
    );

    // Push the changes to the remote repository
    Logger.info('Pushing changes...');
    await withRetry('Pushing changes', async () => git.push());

    Logger.success('Changes pushed successfully.');
  } catch (error) {
    Logger.error('Failed to push changes.');
    throw error;
  }  

};
export const discardUncommittedChanges = async (dir: string) => {
  const git = simpleGit(dir);

  try {
    // Reset tracked files to HEAD
    await withRetry('Resetting tracked files', async () => git.reset(ResetMode.HARD));

    // Restore any deleted tracked files
    await withRetry('Restoring deleted tracked files', async () =>
      git.checkout(['.'])
    );

    Logger.success('Uncommitted changes discarded.');
  } catch (error) {
    Logger.error('Failed to discard uncommitted changes.');
    throw error;
  }
};