import { Logger } from '../utils/logger.js';
import { simpleGit } from 'simple-git';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the project root directory (two levels up from src/commands)
const projectRoot = path.resolve(__dirname, '../../');

export const update = async () => {
  try {
    Logger.info('Updating dm tool...');
    
    // Check if we're in a git repository
    if (!existsSync(path.join(projectRoot, '.git'))) {
      throw new Error('This command must be run from within a git repository');
    }

    const git = simpleGit(projectRoot);
    
    // Fetch the latest changes
    Logger.info('Fetching latest changes...');
    await git.fetch();
    
    // Get the current status
    const status = await git.status();
    
    // Check if we're behind the remote
    if (status.behind > 0) {
      Logger.info(`Found ${status.behind} updates. Pulling changes...`);
      await git.pull();
      Logger.success('Pulled latest changes successfully.');
    } else {
      Logger.info('Already up to date.');
    }
    
    if (status.behind > 0) {
      Logger.info('Installing dependencies and building...');
      execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
      Logger.success('Install and build completed successfully.');
    }
    
    Logger.success('dm tool updated successfully!');
  } catch (error) {
    Logger.error('Failed to update dm tool:', error);
    throw error;
  }
};