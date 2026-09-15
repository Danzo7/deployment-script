import Table from 'cli-table3';
import chalk from 'chalk';
import { DatabaseRepo } from '../db/repos.js';
import { testConnection } from '../db-migration/connector.js';
import { Logger } from '../utils/logger.js';

export async function dbList(): Promise<void> {
  const databases = await DatabaseRepo.getAll();

  if (databases.length === 0) {
    Logger.info('No databases registered');
    return;
  }

  // Test connections in parallel
  const tests = await Promise.allSettled(
    databases.map((db) => testConnection(db.name))
  );

  const table = new Table({
    head: ['NAME', 'HOST:PORT', 'DATABASE', 'STATUS'],
    colWidths: [20, 30, 20, 15],
  });

  for (let i = 0; i < databases.length; i++) {
    const db = databases[i];
    const testResult = tests[i];

    let status = chalk.red('○ offline');
    if (testResult.status === 'fulfilled' && testResult.value.ok) {
      status = chalk.green('● online');
    }

    table.push([
      db.name,
      `${db.host}:${db.port}`,
      db.database,
      status,
    ]);
  }

  console.log(table.toString());
}
