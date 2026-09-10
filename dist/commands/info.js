import chalk from "chalk";
import { AppRepo } from "../db/repos.js";
import { getLastRevision } from "../utils/vcs-helper.js";
import { ensureDirectories } from "../utils/file-utils.js";
import { formatDate } from "../utils/date-helper.js";
import { getProcessInfo } from "../utils/pm2-helper.js";
import { getDirectorySize, formatSize } from "./storage.js";
import { getAppRouteLines } from "./domain.js";
import { Logger } from "../utils/logger.js";
import path from "path";
const info = async ({ name }) => {
  const app = await AppRepo.findByNameWithStorages(name);
  const { relDir } = ensureDirectories(app.appDir);
  let commitHash = "N/A";
  let commitMessage = "N/A";
  let commitAuthor = "N/A";
  let commitDate = "N/A";
  try {
    const commit = app.lastDeployedCommit ?? await getLastRevision(app, relDir);
    if (commit) {
      commitHash = commit.hash;
      commitMessage = commit.message;
      commitAuthor = commit.author;
      commitDate = formatDate(commit.date);
    }
  } catch {
  }
  let status = "stopped";
  let memory = "N/A";
  let uptime = "N/A";
  let restarts = "N/A";
  let scriptPath = "N/A";
  let scriptArgs = "N/A";
  try {
    const { status: s, proc } = await getProcessInfo(name);
    status = s;
    if (proc?.monit?.memory) {
      memory = `${Math.round(proc.monit.memory / 1024 / 1024)} MB`;
    }
    if (proc?.pm2_env) {
      const env = proc.pm2_env;
      if (env.pm_uptime) {
        const uptimeSec = Math.floor((Date.now() - env.pm_uptime) / 1e3);
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor(uptimeSec % 3600 / 60);
        const s2 = uptimeSec % 60;
        uptime = `${h}h ${m}m ${s2}s`;
      }
      restarts = env?.unstable_restarts ?? env?.restart_time ?? "0";
      scriptPath = env?.pm_exec_path ?? "N/A";
      scriptArgs = Array.isArray(env?.args) ? env.args.join(" ") : env?.args ?? "N/A";
    }
  } catch {
  }
  const activeBuildPath = app.activeBuild ? path.basename(await AppRepo.resolveActiveBuild(name) ?? app.activeBuild) : "N/A";
  Logger.nl();
  Logger.print(chalk.bold.cyan(`  ${name}`));
  Logger.divider();
  Logger.row("Port", chalk.blue(app.port.toString()));
  Logger.row("Type", chalk.white(app.projectType));
  Logger.row("VCS", chalk.white(app.vcsType ?? "git"));
  Logger.row(app.vcsType === "svn" ? "SVN Path" : "Branch", chalk.white(app.branch));
  Logger.row("Status", status === "online" ? chalk.green(status) : chalk.red(status));
  Logger.row("Memory", chalk.white(memory));
  Logger.row("Uptime", chalk.white(uptime));
  Logger.row("Restarts", chalk.white(restarts.toString()));
  Logger.row("Builds", chalk.white((app.builds?.length ?? 0).toString()));
  Logger.row("Active Build", chalk.white(activeBuildPath));
  Logger.row(
    "Last Deploy",
    chalk.yellow(formatDate(app.lastDeploy, chalk.gray("Never")))
  );
  Logger.divider();
  Logger.row("Script", chalk.white(scriptPath));
  Logger.row("Script Args", chalk.white(scriptArgs));
  Logger.divider();
  Logger.row("Commit", chalk.white(commitHash));
  Logger.row("Message", chalk.white(commitMessage));
  Logger.row("Author", chalk.white(commitAuthor));
  Logger.row("Commit Date", chalk.white(commitDate));
  if (app.storages.length > 0) {
    Logger.divider();
    for (const storage of app.storages) {
      const size = formatSize(getDirectorySize(storage.path));
      Logger.row(
        "Storage",
        `${chalk.white(storage.name)} ${chalk.gray("(")}${chalk.green(size)}${chalk.gray(")")}`
      );
    }
  }
  const routeLines = await getAppRouteLines(name);
  if (routeLines.length > 0) {
    Logger.divider();
    for (const line of routeLines) {
      Logger.row("Route", line);
    }
  }
  Logger.nl();
};
export {
  info
};
