#!/usr/bin/env node
import yargs from "yargs";
import chalk from "chalk";
import { Logger } from "./utils/logger.js";
import { acquireLock, releaseLock } from "./utils/lock-utils.js";
import { isMigrationNeeded } from "./commands/migrate-db.js";
import { startRepl } from "./repl.js";
import {
  COMMANDS,
  isGroup,
  ensureAppDirectories
} from "./command-registry.js";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const _require = createRequire(import.meta.url);
const _pkg = _require(
  resolve(dirname(fileURLToPath(import.meta.url)), "../package.json")
);
const setupCleanup = (name) => {
  const cleanUp = () => {
    releaseLock(name);
    process.exit();
  };
  process.on("exit", cleanUp);
  process.on("SIGINT", cleanUp);
  process.on("uncaughtException", (err) => {
    Logger.error("Unhandled exception:", err);
    cleanUp();
  });
};
function wrapHandler(node) {
  return async (argv) => {
    try {
      if (node.lockArg) {
        acquireLock(argv[node.lockArg]);
        setupCleanup(argv[node.lockArg]);
      }
      await node.handler(argv);
      if (node.streaming) {
        await new Promise(() => {
        });
      }
    } catch (err) {
      Logger.error(err);
      process.exit(1);
    }
  };
}
function buildLeafYargs(yb, node) {
  let y = yb;
  for (const p of node.positionals ?? []) {
    y = y.positional(p.name, {
      type: p.type ?? "string",
      demandOption: p.demandOption,
      describe: p.describe
    });
  }
  for (const [key, spec] of Object.entries(node.options ?? {})) {
    y = y.option(spec.flag ?? key, {
      type: spec.type,
      alias: spec.alias,
      default: spec.default,
      choices: spec.choices,
      describe: spec.describe,
      demandOption: spec.demandOption
    });
  }
  return y;
}
function registerNode(y, key, node) {
  if (isGroup(node)) {
    return y.command(key, node.describe, (sub) => {
      let s = sub;
      for (const [subKey, subNode] of Object.entries(node.subcommands)) {
        s = registerNode(s, subKey, subNode);
      }
      return s.demandCommand(1);
    });
  }
  return y.command(
    node.usage,
    node.describe,
    (yb) => buildLeafYargs(yb, node),
    wrapHandler(node)
  );
}
await ensureAppDirectories();
const startTime = Date.now();
if (isMigrationNeeded()) {
  Logger.info(chalk.yellow("\n\u26A0\uFE0F  Legacy db.json file detected!"));
  Logger.info(
    chalk.cyan("The database has been migrated to SQL (SQLite/PostgreSQL).")
  );
  Logger.info(
    chalk.cyan(
      'Run "dm migrate-db" to migrate your data from db.json to the new database.\n'
    )
  );
}
if (process.argv.slice(2).length === 0) {
  await startRepl(_pkg.version);
  process.exit(0);
}
const rawArgs = process.argv.slice(2);
const { handleQuickConnect } = await import("./utils/quick-connect.js");
if (await handleQuickConnect(rawArgs)) {
  process.exit(0);
}
try {
  let cli = yargs(process.argv.slice(2)).scriptName("dm");
  for (const [key, node] of Object.entries(COMMANDS)) {
    cli = registerNode(cli, key, node);
  }
  await cli.demandCommand(1, "You must specify a command to run.").strictCommands().parseAsync();
} catch (err) {
  Logger.error(err);
}
const endTime = Date.now();
const timeTaken = ((endTime - startTime) / 1e3).toFixed(2);
Logger.info(`${timeTaken} seconds`);
process.exit();
