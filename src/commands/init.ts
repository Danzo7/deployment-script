import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { findAvailablePort } from '../utils/network-utils.js';
import path from 'path';
import { ensureDirectories } from '../utils/file-utils.js';
import { checkSvn } from '../utils/svn-helper.js';
import { checkDotnetInstalled } from '../utils/dotnet-helper.js';
import { checkGit } from '../utils/git-helper.js';
import { checkLocalFolder } from '../utils/local-folder-helper.js';

export const init = async ({
  name,
  repo,
  branch,
  instances,
  port,
  appsDir,
  type="nextjs",
  projectDir,
  vcsType = 'git',
}: {
  name: string;
  repo: string;
  branch: string;
  instances?: number;
  port?: number;
  appsDir: string;
  type?: 'nextjs' | 'nestjs' | 'dotnet' | 'static';
  projectDir?: string;
  vcsType?: 'git' | 'svn' | 'local';
}) => {
  if (!repo) throw new Error('Repository URL or local folder path is required.');

  if (vcsType === 'svn') checkSvn();
  if (vcsType === 'git') checkGit();
  if (vcsType === 'local') checkLocalFolder(repo);
  if (type === 'dotnet') checkDotnetInstalled();

  // Check if app already exists
  try {
    await AppRepo.findByName(name);
    throw new Error(`An app with the name "${name}" already exists.`);
  } catch (err: any) {
    // If app not found, that's what we want - continue
    if (!err.message?.includes('not found')) {
      throw err;
    }
  }

  const appDir = path.join(appsDir, name);
  ensureDirectories(appDir);

  // Find an available port if none is specified
  if (!port) {
    Logger.info('Port not specified. Searching for an available port...');
    const apps = await AppRepo.getAll();
    port = await findAvailablePort(apps.map((a) => a.port));
  }

  await AppRepo.add({
    port,
    repo,
    branch,
    instances,
    name,
    appDir,
    projectType: type,
    vcsType,
    ...(projectDir ? { projectDir } : {}),
   });

  Logger.success(`The app "${Logger.highlight(name)}" (${type || 'nextjs'}) was successfully added!`);

  Logger.advice(
    `Next steps: Run ${Logger.command(
      `dm deploy ${name}`
    )} to deploy the app. Use ${Logger.command(`dm list`)} to verify its status.`
  );
};
