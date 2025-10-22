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
    
    // Check if we need to rebuild (if package.json or source files changed)
    const needsRebuild = status.modified.includes('package.json') || 
                         status.modified.some(file => file.startsWith('src/')) ||
                         status.created.some(file => file.startsWith('src/')) ||
                         status.deleted.some(file => file.startsWith('src/')) ||
                         status.behind > 0;
    
    if (needsRebuild) {
      Logger.info('Building the project...');
      
      // Run npm install if package.json changed
      if (status.modified.includes('package.json')) {
        Logger.info('Installing dependencies...');
        execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
      }
      
      // Build the project
      Logger.info('Compiling...');
      execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
      
      Logger.success('Build completed successfully.');
    } else {
      Logger.info('No rebuild needed.');
    }
    
    Logger.success('dm tool updated successfully!');
  } catch (error) {
    Logger.error('Failed to update dm tool:', error);
    throw error;
  }
};