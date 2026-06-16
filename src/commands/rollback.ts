import path from 'path';
import chalk from 'chalk';
import { AppRepo, StorageRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { applyStorageSymlinks, ensureDirectories } from '../utils/file-utils.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';

export const rollback = async ({ name, to }: { name: string; to?: number }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  const builds = app.builds ?? [];
  if (builds.length < 2) {
    throw new Error(`Not enough builds to rollback. Only ${builds.length} build(s) available.`);
  }

  const activePath = AppRepo.resolveActiveBuild(name);
  const currentIndex = activePath ? builds.indexOf(activePath) : builds.length - 1;

  // If no --to flag, list available builds and default to previous
  if (to === undefined) {
    console.log();
    console.log(chalk.bold.cyan(`  Available builds for ${name}:`));
    builds.forEach((b, i) => {
      const tag = i === currentIndex ? chalk.green(' ← active') : '';
      console.log(`  ${chalk.gray(i)}  ${path.basename(b)}${tag}`);
    });
    console.log();
    to = currentIndex > 0 ? currentIndex - 1 : 0;
    Logger.info(`Defaulting to build index ${to}: ${Logger.highlight(path.basename(builds[to]))}`);
  }

  if (to < 0 || to >= builds.length) {
    throw new Error(`Invalid build index ${to}. Valid range: 0–${builds.length - 1}`);
  }
  if (to === currentIndex) {
    Logger.info(`Build ${to} is already the active build.`);
    return;
  }

  const targetBuild = builds[to];
  const { logDir } = ensureDirectories(app.appDir);
  const status = await getAppStatus(name);

  Logger.info(`Rolling back ${Logger.highlight(name)} to build ${to}: ${path.basename(targetBuild)}...`);

  await runApp(targetBuild, {
    name: app.name,
    port: app.port,
    instances: app.instances,
    status,
    output: path.join(logDir, 'pm2.out.log'),
    error: path.join(logDir, 'pm2.error.log'),
    projectType: app.projectType,
  });

  AppRepo.update(name, { activeBuild: targetBuild });
  const linkedStorages = (app.linkedStorages ?? [])
    .map((n) => { try { return StorageRepo.findByName(n); } catch { return null; } })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  applyStorageSymlinks(targetBuild, linkedStorages);
  Logger.success(`${Logger.highlight(name)} rolled back to build ${to} successfully.`);
};
