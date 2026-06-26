import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { changeRepoUrl } from '../utils/vcs-helper.js';

export const changeRepo = async ({
  name,
  newRepo,
}: {
  name: string;
  newRepo: string;
}) => {
  if (!newRepo) {
    throw new Error('New repository URL is required.');
  }

  // Fetch the app from the database
  const app = await AppRepo.findByName(name);

  Logger.info(`Changing repository for app "${Logger.highlight(name)}"...`);
  Logger.info(`Current repository: ${app.repo}`);
  Logger.info(`New repository: ${newRepo}`);

  // Change the remote URL in the actual repository folder
  await changeRepoUrl(app, app.appDir, newRepo);

  // Update the database
  await AppRepo.update(name, { repo: newRepo });

  Logger.success(`Repository for "${Logger.highlight(name)}" has been changed successfully!`);
  Logger.advice(
    `The repository URL has been updated in both the database and the local repository. ` +
    `Run ${Logger.command(`dm deploy ${name}`)} to deploy from the new repository.`
  );
};
