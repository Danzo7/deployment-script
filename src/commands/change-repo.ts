import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { changeRepoUrl } from '../utils/vcs-helper.js';

export const changeRepo = async ({
  name,
  newRepo,
  newBranch,
}: {
  name: string;
  newRepo?: string;
  newBranch?: string;
}) => {
  if (!newRepo && !newBranch) {
    throw new Error('At least one of repository URL or branch name is required.');
  }

  // Fetch the app from the database
  const app = await AppRepo.findByName(name);

  Logger.info(`Changing repository for app "${Logger.highlight(name)}"...`);
  
  if (newRepo) {
    Logger.info(`Current repository: ${app.repo}`);
    Logger.info(`New repository: ${newRepo}`);
  }
  
  if (newBranch) {
    Logger.info(`Current branch: ${app.branch}`);
    Logger.info(`New branch: ${newBranch}`);
  }

  // Change the remote URL and/or branch in the actual repository folder
  await changeRepoUrl(app, app.appDir, newRepo || app.repo, newBranch);

  // Update the database
  const updates: Partial<Pick<typeof app, 'repo' | 'branch'>> = {};
  if (newRepo) updates.repo = newRepo;
  if (newBranch) updates.branch = newBranch;
  await AppRepo.update(name, updates);

  Logger.success(
    `Repository for "${Logger.highlight(name)}" has been changed successfully!`
  );
  Logger.advice(
    `The repository ${newRepo ? 'URL ' : ''}${newRepo && newBranch ? 'and ' : ''}${newBranch ? 'branch ' : ''}${newRepo || newBranch ? 'has' : 'have'} been updated. ` +
      `Run ${Logger.command(`dm deploy ${name}`)} to deploy from the ${newBranch ? 'new branch' : 'new repository'}.`
  );
};
