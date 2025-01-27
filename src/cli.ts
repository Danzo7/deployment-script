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
import { generateIISConfig } from './commands/iis-config.js';
import { generateWorkflow } from './commands/generate-workflow.js';
import { unlock } from './commands/unlock.js';
import { clean } from './commands/clean.js';
import { setEnvForApp } from './commands/set-env.js';
import { Delete } from './commands/delete.js';
import { startAllApplications } from './commands/start-all.js';

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
    ).command(
      'iis-config <name>',
      'Generate an IIS config file for reverse proxy',
      (yargs) =>
        yargs
          .positional('name', {
            type: 'string',
            demandOption: true,
            describe: 'The name of the application',
          })
          .option('https', {
            type: 'boolean',
            default: false,
            describe: 'Include HTTPS redirection rules',
          })
          .option('non-www', {
            type: 'boolean',
            default: false,
            describe: 'Redirect all traffic to non-WWW',
          }),
      async (args) => {
        await generateIISConfig(args);
      })
      .command(
        'workflow <name>',
        'Generate and push Gitea workflow to remote repository',
        (yargs) =>
          yargs
            .positional('name', {
              type: 'string',
              demandOption: true,
              describe: 'The name of the application',
            })
           ,
        async (args) => {
          await generateWorkflow(args);
        }) .command(
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
