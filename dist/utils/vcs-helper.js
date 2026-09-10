import { simpleGit, CheckRepoActions } from "simple-git";
import {
  handleGitRepo,
  getLastCommit,
  discardUncommittedChanges,
  pushChanges,
  changeRemoteUrl,
  isGitRepo
} from "./git-helper.js";
import {
  handleSvnRepo,
  getLastSvnRevision,
  discardSvnChanges,
  relocateSvnRepo,
  isSvnRepo
} from "./svn-helper.js";
import {
  handleLocalFolder,
  getLocalFolderRevision
} from "./local-folder-helper.js";
import fs from "fs";
const detectVcsType = async (repo) => {
  if (fs.existsSync(repo)) return "local";
  const lower = repo.toLowerCase();
  const hasGitHint = lower.startsWith("git@") || lower.startsWith("git://") || lower.endsWith(".git") || /^https?:\/\//.test(lower) && lower.includes("git");
  const hasSvnHint = lower.startsWith("svn://") || lower.startsWith("svn+ssh://") || lower.includes("svn") || /(\/trunk(\/|$)|\/branches\/|\/tags\/)/.test(lower);
  if (hasGitHint && !hasSvnHint) {
    if (await isGitRepo(repo)) return "git";
  }
  if (hasSvnHint && !hasGitHint) {
    if (isSvnRepo(repo)) return "svn";
  }
  if (await isGitRepo(repo)) return "git";
  if (isSvnRepo(repo)) return "svn";
  throw new Error(
    `Cannot detect VCS type for "${repo}".
  \u2192 The repository is unreachable or not recognised as git or svn.
  \u2192 Pass --vcs git, --vcs svn, or --vcs local explicitly.`
  );
};
const handleRepo = (app, dir) => {
  if (app.vcsType === "svn") {
    return handleSvnRepo({ dir, repo: app.repo, branch: app.branch });
  }
  if (app.vcsType === "local") {
    return handleLocalFolder({ dir, repo: app.repo });
  }
  return handleGitRepo({ dir, repo: app.repo, branch: app.branch });
};
const getLastRevision = async (app, dir) => {
  if (app.vcsType === "svn") {
    return getLastSvnRevision(dir);
  }
  if (app.vcsType === "local") {
    return getLocalFolderRevision(app.repo);
  }
  return getLastCommit(dir);
};
const pushVcsChanges = async (app, dir, commitMessage) => {
  if (app.vcsType === "svn") return;
  return pushChanges({ dir, commitMessage });
};
const discardLocalChanges = async (app, dir) => {
  if (app.vcsType === "svn") {
    return discardSvnChanges(dir);
  }
  if (app.vcsType === "local") {
    return;
  }
  return discardUncommittedChanges(dir);
};
const changeRepoUrl = async (app, dir, newRepo, newBranch) => {
  if (app.vcsType === "svn") {
    return relocateSvnRepo(dir, newRepo, newBranch || app.branch);
  }
  if (app.vcsType === "local") {
    return;
  }
  return changeRemoteUrl(dir, newRepo, newBranch);
};
const getVcsDriftInfo = async (app, dir, doFetch) => {
  if (!fs.existsSync(dir)) {
    return {
      branch: app.branch,
      behind: 0,
      ahead: 0,
      hasLocalChanges: false,
      fetched: false
    };
  }
  if (app.vcsType === "local") {
    return {
      branch: "local",
      behind: 0,
      ahead: 0,
      hasLocalChanges: false,
      fetched: false
    };
  }
  if (app.vcsType === "svn") {
    try {
      const { execSync } = await import("child_process");
      const out = execSync("svn status", {
        cwd: dir,
        stdio: "pipe",
        encoding: "utf8"
      }).trim();
      return {
        branch: app.branch,
        behind: 0,
        ahead: 0,
        hasLocalChanges: out.length > 0,
        fetched: false
      };
    } catch (err) {
      return {
        branch: app.branch,
        behind: 0,
        ahead: 0,
        hasLocalChanges: false,
        fetched: false,
        error: err.message
      };
    }
  }
  try {
    const git = simpleGit(dir);
    const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT).catch(() => false);
    if (!isRepo) {
      return {
        branch: app.branch,
        behind: 0,
        ahead: 0,
        hasLocalChanges: false,
        fetched: false
      };
    }
    if (doFetch) {
      await git.fetch(["--quiet"]).catch(() => {
      });
    }
    const status = await git.status();
    return {
      branch: status.current ?? app.branch,
      behind: status.behind,
      ahead: status.ahead,
      hasLocalChanges: !status.isClean(),
      fetched: doFetch
    };
  } catch (err) {
    return {
      branch: app.branch,
      behind: 0,
      ahead: 0,
      hasLocalChanges: false,
      fetched: false,
      error: err.message
    };
  }
};
export {
  changeRepoUrl,
  detectVcsType,
  discardLocalChanges,
  getLastRevision,
  getVcsDriftInfo,
  handleRepo,
  pushVcsChanges
};
