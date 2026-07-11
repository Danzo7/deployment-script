#!/usr/bin/env node
import yargs, { Argv } from 'yargs';
import chalk from 'chalk';
import { Logger } from './utils/logger.js';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import { isMigrationNeeded } from './commands/migrate-db.js';
import { startRepl } from './repl.js';
import {
  COMMANDS,
  CommandNode,
  LeafCommand,
  isGroup,
  ensureAppDirectories,
} from './command-registry.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { REMOTE_PORT } from './constants.js';

const _require = createRequire(import.meta.url);
const _pkg = _require(
  resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
) as { version: string };

// Centralized cleanup logic — releases an app's lock file on exit.
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

// Wraps a leaf command's handler with locking + uniform error handling, so
// neither command-registry.ts nor any individual command has to repeat
// try/catch or acquireLock/releaseLock boilerplate.
function wrapHandler(node: LeafCommand) {
  return async (argv: any): Promise<void> => {
    try {
      if (node.lockArg) {
        acquireLock(argv[node.lockArg]);
        setupCleanup(argv[node.lockArg]);
      }
      await node.handler(argv);
      if (node.streaming) {
        // e.g. `logs` — pm2's bus (not yargs) owns the process lifecycle now.
        await new Promise<never>(() => {});
      }
    } catch (err) {
      Logger.error(err);
      process.exit(1);
    }
  };
}

function buildLeafYargs(yb: Argv, node: LeafCommand): Argv<any> {
  let y = yb;
  for (const p of node.positionals ?? []) {
    y = y.positional(p.name, {
      type: p.type ?? 'string',
      demandOption: p.demandOption,
      describe: p.describe,
    }) as Argv;
  }
  for (const [key, spec] of Object.entries(node.options ?? {})) {
    y = y.option(spec.flag ?? key, {
      type: spec.type,
      alias: spec.alias,
      default: spec.default,
      choices: spec.choices as string[] | undefined,
      describe: spec.describe,
      demandOption: spec.demandOption,
    }) as Argv;
  }
  return y;
}

// Recursively registers a command-registry node (leaf or group) onto a yargs
// instance. This is the only place that knows how to translate our
// declarative command tree into yargs' `.command()` calls.
function registerNode(y: Argv, key: string, node: CommandNode): Argv {
  if (isGroup(node)) {
    return y.command(key, node.describe, (sub: Argv) => {
      let s = sub;
      for (const [subKey, subNode] of Object.entries(node.subcommands)) {
        s = registerNode(s, subKey, subNode) as Argv;
      }
      return s.demandCommand(1);
    }) as Argv;
  }
  return y.command(
    node.usage,
    node.describe,
    (yb: Argv) => buildLeafYargs(yb, node),
    wrapHandler(node)
  ) as Argv;
}

await ensureAppDirectories();

const startTime = Date.now();

if (isMigrationNeeded()) {
  Logger.info(chalk.yellow('\n⚠️  Legacy db.json file detected!'));
  Logger.info(
    chalk.cyan('The database has been migrated to SQL (SQLite/PostgreSQL).')
  );
  Logger.info(
    chalk.cyan(
      'Run "dm migrate-db" to migrate your data from db.json to the new database.\n'
    )
  );
}

// ─── Interactive REPL mode ────────────────────────────────────────────────────
// When called with no arguments (just `dm`), launch the interactive shell.
if (process.argv.slice(2).length === 0) {
  await startRepl(_pkg.version);
  process.exit(0);
}

// ─── Quick connect: `dm --host <ip> [--port <p>]` ────────────────────────────
// Shorthand so remote users never need to know about the `remote connect`
// subcommand — just `dm --host 10.10.10.10` is enough.
const rawArgs = process.argv.slice(2);
const hostIdx = rawArgs.findIndex((a) => a === '--host' || a === '-H');
if (hostIdx !== -1) {
  const host = rawArgs[hostIdx + 1];
  if (!host || host.startsWith('-')) {
    Logger.error('--host requires a value, e.g. dm --host 10.10.10.10');
    process.exit(1);
  }
  const portIdx = rawArgs.findIndex((a) => a === '--port' || a === '-p');
  const port = portIdx !== -1 ? Number(rawArgs[portIdx + 1]) : REMOTE_PORT;
  const identIdx = rawArgs.findIndex((a) => a === '--identity' || a === '-i');
  const identity = identIdx !== -1 ? rawArgs[identIdx + 1] : undefined;

  const { connectRemote } = await import('./utils/ssh-client.js');
  await connectRemote(host, port, identity);
  process.exit(0);
}

try {
  let cli = yargs(process.argv.slice(2)).scriptName('dm');
  for (const [key, node] of Object.entries(COMMANDS)) {
    cli = registerNode(cli, key, node) as any;
  }
  await cli
    .demandCommand(1, 'You must specify a command to run.')
    .strictCommands()
    .parseAsync();
} catch (err) {
  Logger.error(err);
}
const endTime = Date.now();
const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
Logger.info(`${timeTaken} seconds`);
process.exit();
