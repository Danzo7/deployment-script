import yargs from "yargs";
import { initializeDB } from "./db/db.js";
import { deploy } from "./commands/deploy.js";
import { init } from "./commands/init.js";
import { APP_DIR } from "./constants.js";
import dotenv from "dotenv";
import { acquireLock, releaseLock } from "./utils/lock-utils.js";
import { Logger } from "./utils/logger.js";

dotenv.config({ path: ".env" });

interface InitArgs {
  name: string;
  repo: string;
  branch: string;
  instances: number;
  port?: number; // Optional
}

interface DeployArgs {
  name: string;
}

// Initialize environment
initializeDB();

const argv = yargs(process.argv.slice(2))
  .usage(
    'Usage: $0 <command> [options]\n\nCommands:\n  init    Initialize a new application\n  deploy  Deploy or update an application\n\nUse "$0 <command> --help" for more information on a command.'
  )
  .middleware((argv) => {
    // Centralized locking logic for commands that require 'name'
    const { name } = argv as any as DeployArgs;
    if (name) {
      try {
        acquireLock(name);
      } catch (error) {
        Logger.error(error);
        process.exit(1); // Exit if lock already exists
      }

      // Ensure lock is released on exit or errors
      const cleanUp = () => {
        releaseLock(name);
        process.exit();
      };
      process.on("exit", cleanUp);
      process.on("SIGINT", cleanUp);
      process.on("uncaughtException", cleanUp);
    }
  })
  .command<InitArgs>(
    "init",
    "Initialize a new application",
    (yargs) => {
      yargs.options({
        name: {
          type: "string",
          demandOption: true,
          alias: "n",
          describe: "The name of the application to initialize",
        },
        repo: {
          type: "string",
          demandOption: true,
          alias: "r",
          describe: "The repository URL of the application",
        },
        branch: {
          type: "string",
          default: "main",
          alias: "b",
          describe: "The branch of the repository to use (default: main)",
        },
        instances: {
          type: "number",
          default: 1,
          alias: "i",
          describe: "The number of instances to initialize (default: 1)",
        },
        port: {
          type: "number",
          alias: "p",
          describe: "The port number to use for the application",
        },
      });
    },
    (args) => init({ ...args, appsDir: APP_DIR })
  )
  .command<DeployArgs>(
    "deploy",
    "Deploy or update an application",
    (yargs) => {
      yargs.option("name", {
        type: "string",
        demandOption: true,
        alias: "n",
        describe: "The name of the application to deploy or update",
      });
    },
    (args) => deploy(args)
  )
  .demandCommand(1, "You must specify a command to run.")
  .argv;
