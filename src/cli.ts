#!/usr/bin/env node
import yargs from 'yargs';
import { initializeDB } from './db/db.js';
import { deploy } from './commands/deploy.js';
import { init } from './commands/init.js';
import { APP_DIR } from './constants.js';
import dotenv from 'dotenv';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import { Logger } from './utils/logger.js';
import { listApps } from './commands/list.js';

dotenv.config();

interface InitArgs {
  name: string;
  repo: string;
  branch: string;
  instances: number;
  port?: number;
}

interface DeployArgs {
  name: string;
  force: boolean;
  lint: boolean;
}

// Centralized cleanup logic
const setupCleanup = (name: string) => {
  const cleanUp = () => {
    releaseLock(name);
    process.exit();
  };
  process.on('exit', cleanUp);
  process.on('SIGINT', cleanUp);
  process.on('uncaughtException', (err) => {
    Logger.error('Unhandled exception:', err);
    cleanUp();
  });
};

// Initialize environment
initializeDB();
try {
  await yargs(process.argv.slice(2))
    .usage(
      `Usage: $0 <command> [options]

Commands:
  init    Initialize a new application
  deploy  Deploy or update an application
  list      List all applications

Use "$0 <command> --help" for more information on a command.`
    )
    .middleware((argv) => {
      const { name } = argv as any as DeployArgs;
      if (name) {
        acquireLock(name);
        setupCleanup(name);
      }
    })
    .command<InitArgs>(
      'init',
      'Initialize a new application',
      (yargs) =>
        yargs.options({
          name: {
            type: 'string',
            demandOption: true,
            alias: 'n',
            describe: 'The name of the application to initialize',
          },
          repo: {
            type: 'string',
            demandOption: true,
            alias: 'r',
            describe: 'The repository URL of the application',
          },
          branch: {
            type: 'string',
            default: 'main',
            alias: 'b',
            describe: 'The branch of the repository to use (default: main)',
          },
          instances: {
            type: 'number',
            default: 1,
            alias: 'i',
            describe: 'The number of instances to initialize (default: 1)',
          },
          port: {
            type: 'number',
            alias: 'p',
            describe: 'The port number to use for the application',
          },
        }),
      async (args) => {
        try {
          await init({ ...args, appsDir: APP_DIR });
        } catch (error) {
          Logger.error(error);
          process.exit(1);
        }
      }
    )
    .command<DeployArgs>(
      'deploy <name>',
      'Deploy or update an application',
      (yargs) =>
        yargs
          .positional('name', {
            type: 'string',
            demandOption: true,
            describe: 'The name of the application to deploy or update',
          })
          .option('force', {
            type: 'boolean',
            alias: 'f',
            default: false,
            describe: 'Force the deployment even if no changes are detected',
          })
          .option('lint', {
            type: 'boolean',
            alias: 'l',
            default: false,
            describe: 'Run linting during the deployment process',
          }),
      async (args) => {
        try {
          await deploy({
            name: args.name,
            force: args.force,
            lint: args.lint,
          });
        } catch (error) {
          Logger.error(error);
          process.exit(1);
        }
      }
    )
    .command(
      'list',
      'List all applications',
      (yargs) => yargs,
      async () => {
        await listApps();
      }
    )
    .demandCommand(1, 'You must specify a command to run.')
    .parseAsync();
} catch (err) {
  Logger.error(err);
}
process.exit();
