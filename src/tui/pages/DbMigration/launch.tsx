import { render } from 'ink';
import React from 'react';
import { DbCompareScreen, DbMigrateScreen } from './index.js';
import { Logger } from '../../../utils/logger.js';

export async function launchDbCompare(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write('\x1b[?1049h'); // enter alternate screen
    
    const { waitUntilExit } = render(
      React.createElement(DbCompareScreen, { dbName })
    );

    waitUntilExit()
      .then(() => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        resolve();
      })
      .catch((err) => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
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

  // Track whether migration was actually executed
  let migrationExecuted = false;
  const setMigrationExecuted = () => {
    migrationExecuted = true;
  };
  (globalThis as any).__setMigrationExecuted = setMigrationExecuted;

  return new Promise((resolve, reject) => {
    process.stdout.write('\x1b[?1049h'); // enter alternate screen
    
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
        if (migrationExecuted) {
          Logger.success('Migration completed');
        }
        delete (globalThis as any).__setMigrationExecuted;
        resolve();
      })
      .catch((err) => {
        process.stdout.write('\x1b[?1049l'); // leave alternate screen
        delete (globalThis as any).__setMigrationExecuted;
        reject(err);
      });
  });
}
