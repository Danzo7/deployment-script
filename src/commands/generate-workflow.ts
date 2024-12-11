import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { discardUncommittedChanges, pushChanges } from '../utils/git-helper.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureDirectories } from '../utils/file-utils.js';

export const generateWorkflow = async ({
  name,
}: {
  name: string;
}) => {
  Logger.info(`Generating workflow for app: ${Logger.highlight(name)}...`);

  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) {
    throw new Error(`App "${Logger.highlight(name)}" not found.`);
  }

  // Step 1: Check if the app has been deployed (app.lastDeploy is not null)
  if (!app.lastDeploy) {
    throw new Error(`App "${Logger.highlight(name)}" has not been deployed yet. Cannot generate workflow.`);
  }
  if(app.repo.includes('github')) {
    throw new Error(`"${Logger.highlight(name)}" is using an external version control. Cannot generate workflow.`);
  }

  // Step 2: Create the deploy.yaml content for the Gitea Actions
  const deployYamlContent = `
name: Deploy
run-name: Deploying via Gitea Actions 🚀
on: [push]

jobs:
  Explore-Gitea-Actions:
    runs-on: windows
    steps:
      - name: Deploy Application
        run: |
          dm deploy ${name}
    `;

  // Step 3: Write the deploy.yaml file to the .gitea/workflows directory
  const {relDir} = ensureDirectories(app.appDir);  // Assuming app.appDir is the path to the app's repo
  Logger.info('Cleaning local repository...');
  await discardUncommittedChanges(relDir);

  const workflowDir = join(relDir, '.gitea', 'workflows');
  if(!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
  }
  const yamlFilePath = join(workflowDir, 'deploy.yaml');

  Logger.info(`Writing deploy.yaml to: ${yamlFilePath}`);
  writeFileSync(yamlFilePath, deployYamlContent);

  // Step 4: Use git-helper to push the new workflow to the repository
  Logger.info('Pushing deploy.yaml to Git...');
  await pushChanges({
    dir: relDir,
    commitMessage:"[CLI-tool] Creating deployment workflow"    
  });

  Logger.info('Deploy workflow generated and pushed successfully!');
};
