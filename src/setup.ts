#!/usr/bin/env node
/**
 * dm Setup Script
 * 
 * Runs during npm install (via postinstall script) to:
 * 1. Initialize .env config file (if missing)
 * 2. Run database migration (creates schema, migrates from JSON if exists)
 * 
 * Directories are created automatically when needed by the application.
 */

import { ensureDefaultConfig, isFirstRun } from './utils/first-run-setup.js';
import { migrateFromJSON } from './commands/migrate-db.js';
import chalk from 'chalk';
import { homedir } from 'os';
import path from 'path';

async function setup() {
  try {
    const firstRun = isFirstRun();
    
    // Create .env if missing
    ensureDefaultConfig();
    
    // Run database migration (handles both new installs and migrations from JSON)
    await migrateFromJSON();
    
    if (firstRun) {
      const dmPath = path.join(homedir(), '.dm').replace(homedir(), '~');
      
      console.log('');
      console.log(chalk.cyan('┌─────────────────────────────────────────────────────────────┐'));
      console.log(chalk.cyan('│') + '                                                             ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '  ' + chalk.bold.white('🚀 dm - Deployment Manager') + '                            ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '     ' + chalk.gray('Setup completed successfully') + '                         ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '                                                             ' + chalk.cyan('│'));
      console.log(chalk.cyan('├─────────────────────────────────────────────────────────────┤'));
      console.log(chalk.cyan('│') + '                                                             ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '  ' + chalk.white('Data directory:') + ' ' + chalk.green(dmPath.padEnd(37)) + ' ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '  ' + chalk.white('Config file:   ') + ' ' + chalk.green((dmPath + '/.env').padEnd(37)) + ' ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '  ' + chalk.white('Database:      ') + ' ' + chalk.green('Ready'.padEnd(37)) + ' ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '                                                             ' + chalk.cyan('│'));
      console.log(chalk.cyan('├─────────────────────────────────────────────────────────────┤'));
      console.log(chalk.cyan('│') + '  ' + chalk.bold('Quick Start:') + '                                           ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '                                                             ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '    ' + chalk.yellow('dm init') + ' ' + chalk.gray('<app-name>') + ' ' + chalk.yellow('--repo') + ' ' + chalk.gray('<repo-url>') + '            ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '    ' + chalk.yellow('dm dashboard') + '                                        ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '    ' + chalk.yellow('dm --help') + '                                           ' + chalk.cyan('│'));
      console.log(chalk.cyan('│') + '                                                             ' + chalk.cyan('│'));
      console.log(chalk.cyan('└─────────────────────────────────────────────────────────────┘'));
      console.log('');
    }
  } catch (error) {
    console.error(chalk.red('✗ dm setup failed:'), error);
    process.exit(1);
  }
}

setup();
