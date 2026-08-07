import { AppRepo, AppConfigRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { findAvailablePort } from '../utils/network-utils.js';
import path from 'path';
import { ensureDirectories } from '../utils/file-utils.js';
import { checkSvn } from '../utils/svn-helper.js';
import { checkGit } from '../utils/git-helper.js';
import { checkLocalFolder } from '../utils/local-folder-helper.js';
import { getHandler } from '../app-types/index.js';
import { detectProjectType } from '../utils/app-type-detector.js';
import { detectVcsType } from '../utils/vcs-helper.js';
import type { ProjectType } from '../app-types/index.js';
import type { VcsType } from '../utils/vcs-helper.js';

export const init = async ({
  name,
  repo,
  branch,
  port,
  type,
  projectDir,
  vcsType,
}: {
  name: string;
  repo: string;
  branch: string;
  port?: number;
  type?: ProjectType;
  projectDir?: string;
  vcsType?: VcsType;
}) => {
  if (!repo) throw new Error('Repository URL or local folder path is required.');

  const resolvedVcsType: VcsType = vcsType ?? await detectVcsType(repo);
  if (!vcsType) {
    Logger.info(`VCS type not specified — detected: ${Logger.highlight(resolvedVcsType)}`);
  }

  if (resolvedVcsType === 'svn') checkSvn();
  if (resolvedVcsType === 'git') checkGit();
  if (resolvedVcsType === 'local') checkLocalFolder(repo);

  // Check if app already exists
  try {
    await AppRepo.findByName(name);
    throw new Error(`An app with the name "${name}" already exists.`);
  } catch (err: any) {
    if (!err.message?.includes('not found')) throw err;
  }

  // Resolve type — explicit or auto-detected
  const resolvedType: ProjectType = type ?? await detectProjectType({
    appName: name,
    repo,
    branch,
    projectDir,
    vcsType: resolvedVcsType,
  });

  // Single prerequisites check after type is known
  const handler = getHandler(resolvedType);
  handler.checkPrerequisites?.();

  const appDir = path.join(handler.getAppsDir(), name);
  ensureDirectories(appDir);

  if (!port) {
    Logger.info('Port not specified. Searching for an available port...');
    const apps = await AppRepo.getAll();
    port = await findAvailablePort(apps.map((a) => a.port));
  }

  const app = await AppRepo.add({
    port,
    repo,
    branch,
    name,
    appDir,
    projectType: resolvedType,
    vcsType: resolvedVcsType,
    ...(projectDir ? { projectDir } : {}),
  });

  await AppConfigRepo.create({ appId: app.id, instances: 1, maxMemory: '250M' });

  Logger.success(`The app "${Logger.highlight(name)}" (${resolvedType}) was successfully added!`);
  Logger.advice(
    `Next steps: Run ${Logger.command(`dm deploy ${name}`)} to deploy the app. Use ${Logger.command(`dm list`)} to verify its status.`
  );
};
