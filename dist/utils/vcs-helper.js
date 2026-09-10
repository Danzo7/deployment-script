import { simpleGit, CheckRepoActions } from 'simple-git';
import { handleGitRepo, getLastCommit, discardUncommittedChanges, pushChanges, changeRemoteUrl, isGitRepo, } from './git-helper.js';
import { handleSvnRepo, getLastSvnRevision, discardSvnChanges, relocateSvnRepo, isSvnRepo, } from './svn-helper.js';
import { handleLocalFolder, getLocalFolderRevision, } from './local-folder-helper.js';
import fs from 'fs';
/**
 * Detects the VCS type for a given repo URL or local path.
 */
export const detectVcsType = async (repo) => {
    // 1. Local path
    if (fs.existsSync(repo))
        return 'local';
    const lower = repo.toLowerCase();
    const hasGitHint = lower.startsWith('git@') ||
        lower.startsWith('git://') ||
        lower.endsWith('.git') ||
        (/^https?:\/\//.test(lower) && lower.includes('git'));
    const hasSvnHint = lower.startsWith('svn://') ||
        lower.startsWith('svn+ssh://') ||
        lower.includes('svn') ||
        /(\/trunk(\/|$)|\/branches\/|\/tags\/)/.test(lower);
    // 2. Git-hinted, not svn-hinted → probe git first
    if (hasGitHint && !hasSvnHint) {
        if (await isGitRepo(repo))
            return 'git';
        // git probe failed — could still be svn, fall through
    }
    // 3. SVN-hinted, not git-hinted → probe svn first
    if (hasSvnHint && !hasGitHint) {
        if (isSvnRepo(repo))
            return 'svn';
        // svn probe failed — fall through
    }
    // 4. Ambiguous or neither hint — probe both
    if (await isGitRepo(repo))
        return 'git';
    if (isSvnRepo(repo))
        return 'svn';
    throw new Error(`Cannot detect VCS type for "${repo}".\n` +
        `  → The repository is unreachable or not recognised as git or svn.\n` +
        `  → Pass --vcs git, --vcs svn, or --vcs local explicitly.`);
};
export const handleRepo = (app, dir) => {
    if (app.vcsType === 'svn') {
        return handleSvnRepo({ dir, repo: app.repo, branch: app.branch });
    }
    if (app.vcsType === 'local') {
        return handleLocalFolder({ dir, repo: app.repo });
    }
    return handleGitRepo({ dir, repo: app.repo, branch: app.branch });
};
export const getLastRevision = async (app, dir) => {
    if (app.vcsType === 'svn') {
        return getLastSvnRevision(dir);
    }
    if (app.vcsType === 'local') {
        return getLocalFolderRevision(app.repo);
    }
    return getLastCommit(dir);
};
export const pushVcsChanges = async (app, dir, commitMessage) => {
    if (app.vcsType === 'svn')
        return; // SVN has no push workflow
    return pushChanges({ dir, commitMessage });
};
export const discardLocalChanges = async (app, dir) => {
    if (app.vcsType === 'svn') {
        return discardSvnChanges(dir);
    }
    if (app.vcsType === 'local') {
        return; // nothing to discard — release dir is a copy, source is untouched
    }
    return discardUncommittedChanges(dir);
};
export const changeRepoUrl = async (app, dir, newRepo, newBranch) => {
    if (app.vcsType === 'svn') {
        return relocateSvnRepo(dir, newRepo, newBranch || app.branch);
    }
    if (app.vcsType === 'local') {
        return; // repo path is updated in the DB by the caller; no in-dir action needed
    }
    return changeRemoteUrl(dir, newRepo, newBranch);
};
/**
 * Returns ahead/behind/dirty state for an app's release directory.
 * For SVN: only hasLocalChanges is meaningful (behind/ahead are always 0).
 * @param doFetch - whether to run git fetch / svn update check (expensive; skip on fast-poll ticks)
 */
export const getVcsDriftInfo = async (app, dir, doFetch) => {
    if (!fs.existsSync(dir)) {
        return {
            branch: app.branch,
            behind: 0,
            ahead: 0,
            hasLocalChanges: false,
            fetched: false,
        };
    }
    if (app.vcsType === 'local') {
        return {
            branch: 'local',
            behind: 0,
            ahead: 0,
            hasLocalChanges: false,
            fetched: false,
        };
    }
    if (app.vcsType === 'svn') {
        try {
            const { execSync } = await import('child_process');
            const out = execSync('svn status', {
                cwd: dir,
                stdio: 'pipe',
                encoding: 'utf8',
            }).trim();
            return {
                branch: app.branch,
                behind: 0,
                ahead: 0,
                hasLocalChanges: out.length > 0,
                fetched: false,
            };
        }
        catch (err) {
            return {
                branch: app.branch,
                behind: 0,
                ahead: 0,
                hasLocalChanges: false,
                fetched: false,
                error: err.message,
            };
        }
    }
    // Git path
    try {
        const git = simpleGit(dir);
        const isRepo = await git
            .checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
            .catch(() => false);
        if (!isRepo) {
            return {
                branch: app.branch,
                behind: 0,
                ahead: 0,
                hasLocalChanges: false,
                fetched: false,
            };
        }
        if (doFetch) {
            await git.fetch(['--quiet']).catch(() => {
                /* network unavailable — proceed with cached */
            });
        }
        const status = await git.status();
        return {
            branch: status.current ?? app.branch,
            behind: status.behind,
            ahead: status.ahead,
            hasLocalChanges: !status.isClean(),
            fetched: doFetch,
        };
    }
    catch (err) {
        return {
            branch: app.branch,
            behind: 0,
            ahead: 0,
            hasLocalChanges: false,
            fetched: false,
            error: err.message,
        };
    }
};
