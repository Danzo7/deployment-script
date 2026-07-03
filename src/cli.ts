#!/usr/bin/env node
import chalk from 'chalk';
import { existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR } from './constants.js';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import { Logger } from './utils/logger.js';
import { isMigrationNeeded } from './commands/migrate-db.js';
import { buildYargs } from './yargs-config.js';
import { startRepl } from './repl.js';

const _require = createRequire(import.meta.url);
const _pkg = _require(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')) as { version: string };

// Ensure base directories exist
for (const dir of [APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Centralized per-command lock cleanup for CLI mode (REPL handles its own)
const setupCleanup = (name: string) => {
  const cleanUp = () => { releaseLock(name); process.exit(); };
  process.on('exit', cleanUp);
  process.on('SIGINT', cleanUp);
  process.on('uncaughtException', (err) => { Logger.error('Unhandled exception:', err); cleanUp(); });
};

if (isMigrationNeeded()) {
  Logger.info(chalk.yellow('\n⚠️  Legacy db.json file detected!'));
  Logger.info(chalk.cyan('The database has been migrated to SQL (SQLite/PostgreSQL).'));
  Logger.info(chalk.cyan('Run "dm migrate-db" to migrate your data from db.json to the new database.\n'));
}

// No arguments → interactive REPL
if (process.argv.slice(2).length === 0) {
  await startRepl(_pkg.version);
  process.exit(0);
}

const startTime = Date.now();

try {
  await buildYargs(process.argv.slice(2))
    .middleware((argv) => {
      const { name, _ } = argv as any;
      if (name && _[0] !== 'unlock') {
        acquireLock(name);
        setupCleanup(name);
      }
    })
    .demandCommand(1, 'You must specify a command to run.')
    .strictCommands()
    .parseAsync();
} catch (err) {
  Logger.error(err);
}

const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
Logger.info(`${timeTaken} seconds`);
process.exit();
