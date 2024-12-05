import  {simpleGit, CheckRepoActions } from "simple-git";
import { Logger } from "./logger.js";
import { withRetry } from "./retry-helper.js";
import { isDirectoryEmpty } from "./file-utils.js";


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
 
  const isGitRepo = await withRetry("Checking Git status", () =>
    git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
  );
  if(!isGitRepo&&!isDirectoryEmpty(dir)){
    throw new Error(`Please Make sure the directory ${dir} is empty or is a valid git repository.`);
   }
  if (!isGitRepo) {
    Logger.info(`Cloning repository ${repo} (branch: ${branch}) into ${dir}`);
    await withRetry("Cloning repository", async () => git.clone(repo, dir, ["--branch", branch]));
    Logger.success(`Repository cloned successfully.`);
    return true
  }

  await withRetry("Fetching repository updates", async () => git.fetch());
  const status = await withRetry("Getting repository status", async () => git.status());

  if (status.ahead > 0) {
    throw new Error(`Cannot deploy: ${status.ahead} commits ahead. Please don't do that.`);
  }

  if (status.behind > 0) {
    Logger.info(`${status.behind} new commits found. Pulling changes...`);
    await withRetry("Pulling changes", async () => git.pull());
    return true
  }

  Logger.info("Repository is up-to-date. No changes detected.");
  return false;
}
