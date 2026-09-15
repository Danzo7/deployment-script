import { render } from 'ink';
import React from 'react';
import { DbCompareScreen, DbMigrateScreen } from './index.js';
import { Logger } from '../../../utils/logger.js';

export async function launchDbCompare(dbName: string): Promise<void> {
  Logger.isMuted = true;

  return new Promise((resolve, reject) => {
    process.stdout.write('\x1b[?1049h'); // enter alternate screen
    process.stdout.write('\x1b[H'); // move cursor to home
    
    const { waitUntilExit } = render(
      React.createElement(DbCompareScreen, { dbName })
    );

    waitUntilExit()
      .then(() => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        Logger.isMuted = false;
        resolve();
      })
      .catch((err) => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        Logger.isMuted = false;
        reject(err);
      });
  });
}

export async function launchDbMigrate(args: {
  name: string;
  key: string;
  type?: 'generated' | 'manual';
}): Promise<void> {
  // Check if stdin has data (piped input)
  let initialText = '';
  if (!process.stdin.isTTY) {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    initialText = Buffer.concat(chunks).toString('utf8');
  }

  // Check if migration key already exists before launching TUI
  const { DatabaseRepo, MigrationRepo } = await import('../../../db/repos.js');
  try {
    const database = await DatabaseRepo.findByName(args.name);
    const existing = await MigrationRepo.findByKey(database.id, args.key);
    if (existing) {
      Logger.error(`Migration with key "${args.key}" already exists for database "${args.name}"`);
      Logger.info('Use a different key or check existing migrations with:');
      Logger.info(`  dm db history ${args.name}`);
      return;
    }
  } catch (err: any) {
    // Database not found or other error - let TUI handle it
    if (!err.message?.includes('not found')) {
      Logger.error(`Error checking migration key: ${err.message}`);
      return;
    }
  }

  Logger.isMuted = true;

  // Track whether migration was actually executed
  let migrationExecuted = false;
  const setMigrationExecuted = () => {
    migrationExecuted = true;
  };
  (globalThis as any).__setMigrationExecuted = setMigrationExecuted;

  return new Promise((resolve, reject) => {
    process.stdout.write('\x1b[?1049h'); // enter alternate screen
    process.stdout.write('\x1b[H'); // move cursor to home
    
    const { waitUntilExit } = render(
      React.createElement(DbMigrateScreen, {
        dbName: args.name,
        migrationKey: args.key,
        migrationType: args.type,
        initialText,
      })
    );

    waitUntilExit()
      .then(() => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        Logger.isMuted = false;
        if (migrationExecuted) {
          Logger.success('Migration completed');
        }
        delete (globalThis as any).__setMigrationExecuted;
        resolve();
      })
      .catch((err) => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        Logger.isMuted = false;
        delete (globalThis as any).__setMigrationExecuted;
        reject(err);
      });
  });
}
