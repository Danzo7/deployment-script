import React from 'react';
import { DbCompareScreen, DbMigrateScreen } from './index.js';
import { Logger } from '../../../utils/logger.js';
import { launchTui } from '../../utils/launch-tui.js';

export async function launchDbCompare(dbName: string): Promise<void> {
  await launchTui(
    React.createElement(DbCompareScreen, { dbName })
  );
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

  // Track whether migration was actually executed
  let migrationExecuted = false;
  const setMigrationExecuted = () => {
    migrationExecuted = true;
  };
  (globalThis as any).__setMigrationExecuted = setMigrationExecuted;

  await launchTui(
    React.createElement(DbMigrateScreen, {
      dbName: args.name,
      migrationKey: args.key,
      migrationType: args.type,
      initialText,
    }),
    {
      onExit: () => {
        if (migrationExecuted) {
          Logger.success('Migration completed');
        }
        delete (globalThis as any).__setMigrationExecuted;
      },
    }
  );
}
