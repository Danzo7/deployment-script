import { render } from 'ink';
import React from 'react';
import { DbCompareScreen, DbMigrateScreen } from './index.js';
import { Logger } from '../../../utils/logger.js';

export async function launchDbCompare(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { waitUntilExit } = render(
      React.createElement(DbCompareScreen, { dbName })
    );

    waitUntilExit()
      .then(() => {
        resolve();
      })
      .catch(reject);
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

  return new Promise((resolve, reject) => {
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
        Logger.success('Migration completed');
        resolve();
      })
      .catch(reject);
  });
}
