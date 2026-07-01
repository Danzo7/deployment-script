import { App } from '../db/model.js';
import { simpleGit, CheckRepoActions } from 'simple-git';
import { handleGitRepo, getLastCommit, discardUncommittedChanges, pushChanges, changeRemoteUrl } from './git-helper.js';
import { handleSvnRepo, getLastSvnRevision, discardSvnChanges, relocateSvnRepo } from './svn-helper.js';
import fs from 'fs';

export const handleRepo = (
  app: Pick<App, 'vcsType' | 'repo' | 'branch'>,
  dir: string
): Promise<boolean> => {
  if (app.vcsType === 'svn') {
    return handleSvnRepo({ dir, repo: app.repo, branch: app.branch });
  }
  return handleGitRepo({ dir, repo: app.repo, branch: app.branch });
};

export const getLastRevision = async (
  app: Pick<App, 'vcsType'>,
  dir: string
): Promise<{ hash: string; message: string; author: string; date: string } | null> => {
  if (app.vcsType === 'svn') {
    return getLastSvnRevision(dir);
  }
  return getLastCommit(dir);
};

export const pushVcsChanges = async (
  app: Pick<App, 'vcsType'>,
  dir: string,
  commitMessage: string
): Promise<void> => {
  if (app.vcsType === 'svn') return; // SVN has no push workflow
  return pushChanges({ dir, commitMessage });
};

export const discardLocalChanges = async (
  app: Pick<App, 'vcsType'>,
  dir: string
): Promise<void> => {
  if (app.vcsType === 'svn') {
    return discardSvnChanges(dir);
  }
  return discardUncommittedChanges(dir);
};

export const changeRepoUrl = async (
  app: Pick<App, 'vcsType' | 'branch'>,
  dir: string,
  newRepo: string
): Promise<void> => {
  if (app.vcsType === 'svn') {
    return relocateSvnRepo(dir, newRepo, app.branch);
  }
  return changeRemoteUrl(dir, newRepo);
};

export interface VcsDriftInfo {
  branch: string;
  /** commits behind remote (git only; 0 for svn) */
  behind: number;
  /** commits ahead of remote (git only; 0 for svn) */
  ahead: number;
  /** uncommitted local changes in release dir */
  hasLocalChanges: boolean;
  /** true once a fetch/update has run; false means data is from cache */
  fetched: boolean;
  error?: string;
}

/**
 * Returns ahead/behind/dirty state for an app's release directory.
 * For SVN: only hasLocalChanges is meaningful (behind/ahead are always 0).
 * @param doFetch - whether to run git fetch / svn update check (expensive; skip on fast-poll ticks)
 */
export const getVcsDriftInfo = async (
  app: Pick<App, 'vcsType' | 'branch'>,
  dir: string,
  doFetch: boolean,
): Promise<VcsDriftInfo> => {
  if (!fs.existsSync(dir)) {
    return { branch: app.branch, behind: 0, ahead: 0, hasLocalChanges: false, fetched: false };
  }

  if (app.vcsType === 'svn') {
    try {
      const { execSync } = await import('child_process');
      const out = execSync('svn status', { cwd: dir, stdio: 'pipe', encoding: 'utf8' }).trim();
      return {
        branch: app.branch,
        behind: 0,
        ahead: 0,
        hasLocalChanges: out.length > 0,
        fetched: false,
      };
    } catch (err: any) {
      return { branch: app.branch, behind: 0, ahead: 0, hasLocalChanges: false, fetched: false, error: err.message };
    }
  }

  // Git path
  try {
    const git = simpleGit(dir);
    const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT).catch(() => false);
    if (!isRepo) {
      return { branch: app.branch, behind: 0, ahead: 0, hasLocalChanges: false, fetched: false };
    }
    if (doFetch) {
      await git.fetch(['--quiet']).catch(() => { /* network unavailable — proceed with cached */ });
    }
    const status = await git.status();
    return {
      branch: status.current ?? app.branch,
      behind: status.behind,
      ahead: status.ahead,
      hasLocalChanges: !status.isClean(),
      fetched: doFetch,
    };
  } catch (err: any) {
    return { branch: app.branch, behind: 0, ahead: 0, hasLocalChanges: false, fetched: false, error: err.message };
  }
};
