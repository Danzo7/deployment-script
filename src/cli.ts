#!/usr/bin/env node
import yargs from 'yargs';
import { initializeDB } from './db/db.js';
import { deploy } from './commands/deploy.js';
import { init } from './commands/init.js';
import { APP_DIR } from './constants.js';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import { Logger } from './utils/logger.js';
import { listApps } from './commands/list.js';
import { existsSync, mkdirSync } from 'fs';
import { unlock } from './commands/unlock.js';
import { clean } from './commands/clean.js';
import { setEnvForApp } from './commands/set-env.js';
import { Delete } from './commands/delete.js';
import { startAllApplications } from './commands/start-all.js';
import { stopAllApplications } from './commands/stop-all.js';
import { update } from './commands/update.js';
import { setUrl } from './commands/set-url.js';
import { info } from './commands/info.js';
import { restart } from './commands/restart.js';
import { rollback } from './commands/rollback.js';
import { logs } from './commands/logs.js';
import { monit } from './commands/monit.js';
import { cleanAll } from './commands/clean-all.js';

interface InitArgs {
  name: string;
  repo: string;
  branch: string;
  instances: number;
  port?: number;
  type?: 'nextjs' | 'nestjs';
  url?: string;
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
if (!existsSync(APP_DIR)) {
  mkdirSync(APP_DIR, { recursive: true });
}
const startTime = Date.now(); // Start the timer

initializeDB();
try {
  await yargs(process.argv.slice(2)).scriptName('dm')
    .middleware((argv) => {
      const { name ,_} = argv as any as DeployArgs&{_: string[]};
      if (name&&_[0]!="unlock") {
        acquireLock(name);
        setupCleanup(name);
      }
    })
    .command<InitArgs>(
      'init <name>',
      'Initialize a new application',
      (yargs) =>
        yargs
          .positional('name', {
            type: 'string',
            demandOption: true,
            describe: 'The name of the application to initialize',
          })
          .option('repo', {
            type: 'string',
            demandOption: true,
            alias: 'r',
            describe: 'The repository URL of the application',
          })
          .option('branch', {
            type: 'string',
            default: 'main',
            alias: 'b',
            describe:'The port number to use for the application. Defaults to an available port starting from 50xxx if not specified.',
          })
          .option('instances', {
            type: 'number',
            default: 1,
            alias: 'i',
            describe: 'The number of instances to initialize (default: 1)',
          })
          .option('port', {
            type: 'number',
            alias: 'p',
            describe: 'The port number to use for the application (default: find)',
          })
          .option('type', {
            type: 'string',
            choices: ['nextjs', 'nestjs'],
            default: 'nextjs',
            alias: 't',
            describe: 'The type of application (nextjs or nestjs)',
          })
          .option('url', {
            type: 'string',
            alias: 'u',
            describe: 'The public URL or domain of the application',
          }),
      async (args) => {
        try {
          await init({ ...args, appsDir: APP_DIR });
        } catch (error) {          Logger.error(error);
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
    ).command(
          'unlock <name>',
          'Forcefully release the lock for an application by killing its process.',
          (yargs) =>
            yargs.positional('name', {
              type: 'string',
              demandOption: true,
              describe: 'The name of the application',
            }),
           (args) => {
            try {
               unlock(args);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'clean <name>',
          'Clean app directory from local changes.',
          (yargs) =>
            yargs.positional('name', {
              type: 'string',
              demandOption: true,
              describe: 'The name of the application',
            }),
          async (args) => {
            try {
              await clean(args);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )  .command(
          'set-env <name> <env>',
          'Set or update an environment variable for an application',
          (yargs) =>
            yargs
              .positional('name', {
                type: 'string',
                demandOption: true,
                describe: 'The name of the application',
              })
              .positional('env', {
                type: 'string',
                demandOption: true,
                describe:
                  'Environment variable in the format VAR_NAME=VALUE, e.g., API_URL=https://example.com',
              }),
          async (args) => {
            const { name, env } = args as any;
                  const [envName, envValue] = env.split('=');
      
            if (!envName || envValue === undefined) {
              Logger.error(
                `Invalid format for environment variable. Expected format: VAR_NAME=VALUE`
              );
              return;
            }
      
            // Call the function to set the environment variable
            await setEnvForApp({ name, envName, envValue });
          }
        )
        .command(
          "delete <name> <secret>",
          "Delete an application",
          (yargs) =>
            yargs.positional("name", {
              type: "string",
              demandOption: true,
              describe: "The name of the application",
            })
            .positional("secret", {
              type: "string",
              demandOption: true,
              describe: "The secret key",
            }),
          async (args) => {
            if(args.secret!==process.env.SECRET_KEY){
              Logger.error("Invalid secret key");
              process.exit(1);
            }
            await Delete(args);
          }
        )
        .command(
          'start-all',
          'Start all applications',
          (yargs) => yargs,
          async () => {
            try {
              await startAllApplications();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          "stop-all",
          "Stop all applications",
          (yargs) => yargs,
          async () => {
            try {
              await stopAllApplications();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          'clean-all',
          'Clean all apps: discard uncommitted changes and prune old builds',
          (yargs) => yargs,
          async () => {
            try {
              await cleanAll();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          'update',
          'Update the dm tool',
          (yargs) => yargs,
          async () => {
            try {
              await update();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          'set-url <name> <url>',
          'Set or update the public URL/domain for an application',
          (yargs) =>
            yargs
              .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
              .positional('url', { type: 'string', demandOption: true, describe: 'Public URL or domain' }),
          (args) => {
            try {
              setUrl(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'info <name>',
          'Show detailed info about an application',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          async (args) => {
            try {
              await info(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'restart <name>',
          'Restart an application using its active build',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          async (args) => {
            try {
              await restart(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'rollback <name>',
          'Roll back an application to a previous build',
          (yargs) =>
            yargs
              .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
              .option('to', { type: 'number', describe: 'Build index to roll back to (default: previous)' }),
          async (args) => {
            try {
              await rollback({ name: args.name as string, to: args.to });
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'logs <name>',
          'Stream live logs for an application',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          (args) => {
            try {
              logs(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'monit',
          'Open PM2 monitor for all applications',
          (yargs) => yargs,
          () => {
            try {
              monit();
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
    .demandCommand(1, 'You must specify a command to run.')
    .strictCommands()
    .parseAsync();
} catch (err) {
  Logger.error(err);
}  
const endTime = Date.now(); // End the timer
const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Calculate time in seconds
Logger.info(`${timeTaken} seconds`);      
process.exit();
