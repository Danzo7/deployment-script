import { App } from '../db/model.js';
import { handleGitRepo, getLastCommit, discardUncommittedChanges, pushChanges, changeRemoteUrl } from './git-helper.js';
import { handleSvnRepo, getLastSvnRevision, discardSvnChanges, relocateSvnRepo } from './svn-helper.js';

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
