import chalk from 'chalk';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { simpleGit } from 'simple-git';
import { ensureDirectories } from '../utils/file-utils.js';
import { format } from 'date-fns';
import { getProcessInfo } from '../utils/pm2-helper.js';
import path from 'path';

export const info = async ({ name }: { name: string }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  const { relDir } = ensureDirectories(app.appDir);

  // Git last commit
  let commitHash = 'N/A';
  let commitMessage = 'N/A';
  let commitAuthor = 'N/A';
  let commitDate = 'N/A';
  try {
    const git = simpleGit(relDir);
    const log = await git.log({ maxCount: 1 });
    if (log.latest) {
      commitHash = log.latest.hash.slice(0, 7);
      commitMessage = log.latest.message;
      commitAuthor = log.latest.author_name;
      commitDate = format(new Date(log.latest.date), 'yyyy-MM-dd HH:mm:ss');
    }
  } catch {
    // release dir may not be cloned yet
  }

  // PM2 process info
  let status = 'stopped';
  let memory = 'N/A';
  let uptime = 'N/A';
  let restarts = 'N/A';
  let scriptPath = 'N/A';
  let scriptArgs = 'N/A';

  try {
    const { status: s, proc } = await getProcessInfo(name);
    status = s;
    if (proc?.monit?.memory) {
      memory = `${Math.round(proc.monit.memory / 1024 / 1024)} MB`;
    }
    if (proc?.pm2_env) {
      const env = proc.pm2_env as any;
      if (env.pm_uptime) {
        const uptimeSec = Math.floor((Date.now() - env.pm_uptime) / 1000);
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        uptime = `${h}h ${m}m ${s}s`;
      }
      restarts = env?.unstable_restarts ?? env?.restart_time ?? '0';
      scriptPath = env?.pm_exec_path ?? 'N/A';
      scriptArgs = Array.isArray(env?.args) ? env.args.join(' ') : (env?.args ?? 'N/A');
    }
  } catch {
    // pm2 may not be running
  }

  // Active build
  const activeBuildPath =
    app.builds && app.activeBuild !== undefined
      ? path.basename(app.builds[app.activeBuild])
      : 'N/A';

  const row = (label: string, value: string) =>
    console.log(`  ${chalk.gray(label.padEnd(18))} ${value}`);

  console.log();
  console.log(chalk.bold.cyan(`  ${name}`));
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  row('URL', app.url ? chalk.magenta(app.url) : chalk.gray('—'));
  row('Port', chalk.blue(app.port.toString()));
  row('Type', chalk.white(app.projectType));
  row('Branch', chalk.white(app.branch));
  row('Status', status === 'online' ? chalk.green(status) : chalk.red(status));
  row('Memory', chalk.white(memory));
  row('Uptime', chalk.white(uptime));
  row('Restarts', chalk.white(restarts.toString()));
  row('Builds', chalk.white((app.builds?.length ?? 0).toString()));
  row('Active Build', chalk.white(activeBuildPath));
  row('Last Deploy', app.lastDeploy ? chalk.yellow(format(new Date(app.lastDeploy), 'yyyy-MM-dd HH:mm:ss')) : chalk.gray('Never'));
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  row('Script', chalk.white(scriptPath));
  row('Script Args', chalk.white(scriptArgs));
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  row('Commit', chalk.white(commitHash));
  row('Message', chalk.white(commitMessage));
  row('Author', chalk.white(commitAuthor));
  row('Commit Date', chalk.white(commitDate));
  console.log();
};
