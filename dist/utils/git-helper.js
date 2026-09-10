import { execSync } from "child_process";
import { simpleGit, CheckRepoActions, ResetMode } from "simple-git";
import { Logger } from "./logger.js";
import { withRetry } from "./retry-helper.js";
import { isDirectoryEmpty } from "./file-utils.js";
const checkGit = () => {
  try {
    execSync("git --version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "git is not installed or not on your PATH.\n  \u2192 Install git from https://git-scm.com/downloads and re-run the command."
    );
  }
};
const handleGitRepo = async ({
  dir,
  repo,
  branch
}) => {
  checkGit();
  const git = simpleGit(dir);
  const isGitRepo2 = await withRetry(
    "Checking Git status",
    () => git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
  );
  if (!isGitRepo2 && !isDirectoryEmpty(dir)) {
    throw new Error(
      `Please Make sure the directory ${dir} is empty or is a valid git repository.`
    );
  }
  if (!isGitRepo2) {
    Logger.info(`Cloning repository ${repo} (branch: ${branch}) into ${dir}`);
    await withRetry(
      "Cloning repository",
      async () => git.clone(repo, dir, ["--branch", branch])
    );
    Logger.success(`Repository cloned successfully.`);
    return true;
  }
  await withRetry("Fetching repository updates", async () => git.fetch());
  const status = await withRetry(
    "Getting repository status",
    async () => git.status()
  );
  if (status.ahead > 0) {
    Logger.warn(`${status.ahead} commits ahead. Resetting to remote...`);
    await withRetry(
      "Resetting to remote",
      async () => git.reset(["--hard", `origin/${status.current}`])
    );
  }
  const freshStatus = await withRetry(
    "Getting updated repository status",
    async () => git.status()
  );
  if (freshStatus.behind > 0) {
    Logger.info(`${freshStatus.behind} new commits found. Pulling changes...`);
    await withRetry("Pulling changes", async () => git.pull());
    return true;
  }
  Logger.info("Repository is up-to-date. No changes detected.");
  return false;
};
const pushChanges = async ({
  dir,
  commitMessage
}) => {
  const git = simpleGit(dir);
  const status = await withRetry(
    "Getting repository status",
    async () => git.status()
  );
  if (status.behind > 0) {
    throw new Error("Cannot push changes. The repository is not up-to-date.");
  }
  try {
    Logger.info("Staging changes...");
    await withRetry("Staging changes", async () => git.add("."));
    Logger.info("Committing changes...");
    await withRetry(
      "Committing changes",
      async () => git.commit(commitMessage)
    );
    Logger.info("Pushing changes...");
    await withRetry("Pushing changes", async () => git.push());
    Logger.success("Changes pushed successfully.");
  } catch (error) {
    Logger.error("Failed to push changes.");
    throw error;
  }
};
const getLastCommit = async (dir) => {
  const git = simpleGit(dir);
  const log = await git.log({ maxCount: 1 });
  if (!log.latest) return null;
  return {
    hash: log.latest.hash.slice(0, 7),
    message: log.latest.message,
    author: log.latest.author_name,
    date: log.latest.date
  };
};
const discardUncommittedChanges = async (dir) => {
  const git = simpleGit(dir);
  try {
    await withRetry(
      "Resetting tracked files",
      async () => git.reset(ResetMode.HARD)
    );
    await withRetry(
      "Restoring deleted tracked files",
      async () => git.checkout(["."])
    );
    Logger.success("Uncommitted changes discarded.");
  } catch (error) {
    Logger.error("Failed to discard uncommitted changes.");
    throw error;
  }
};
const changeRemoteUrl = async (dir, newUrl, newBranch) => {
  checkGit();
  const git = simpleGit(dir);
  try {
    const remotes = await withRetry(
      "Getting git remotes",
      async () => git.getRemotes(true)
    );
    if (remotes.length === 0) {
      throw new Error("No git remote found in repository");
    }
    const remoteName = remotes[0].name;
    Logger.info(`Changing git remote '${remoteName}' to ${newUrl}`);
    await withRetry(
      "Changing git remote URL",
      async () => git.remote(["set-url", remoteName, newUrl])
    );
    Logger.success(`Git remote URL changed successfully to ${newUrl}`);
    if (newBranch) {
      Logger.info(`Switching to branch '${newBranch}'`);
      await withRetry(
        "Fetching new branch",
        async () => git.fetch([remoteName, newBranch])
      );
      const branches = await withRetry(
        "Getting branches",
        async () => git.branchLocal()
      );
      if (branches.all.includes(newBranch)) {
        await withRetry(
          "Checking out branch",
          async () => git.checkout(newBranch)
        );
      } else {
        await withRetry(
          "Checking out new branch",
          async () => git.checkout(["-b", newBranch, `${remoteName}/${newBranch}`])
        );
      }
      await withRetry("Pulling latest changes", async () => git.pull());
      Logger.success(`Switched to branch '${newBranch}' successfully`);
    }
  } catch (error) {
    Logger.error("Failed to change git remote URL or branch.");
    throw error;
  }
};
const isGitRepo = async (url) => {
  try {
    const git = simpleGit();
    await git.listRemote([url]);
    return true;
  } catch {
    return false;
  }
};
export {
  changeRemoteUrl,
  checkGit,
  discardUncommittedChanges,
  getLastCommit,
  handleGitRepo,
  isGitRepo,
  pushChanges
};
