import { promptSecret } from '../utils/prompt-secret.js';
import { DatabaseRepo } from '../db/repos.js';
import { testConnection } from '../db-migration/connector.js';
import { Logger } from '../utils/logger.js';
import { DB_DEFAULT_HOST, DB_DEFAULT_PORT } from '../constants.js';

export async function dbRegister(args: {
  name: string;
  host?: string;
  port?: number;
  database?: string;
  username: string;
  sslMode?: 'disable' | 'require' | 'verify-full';
  ownerRole?: string;
}): Promise<void> {
  // Apply defaults
  const host = args.host ?? DB_DEFAULT_HOST;
  const port = args.port ?? DB_DEFAULT_PORT;
  const database = args.database ?? args.name; // Use connection name as database name if not specified

  Logger.info(`Registering database connection "${args.name}"...`);
  Logger.info(`  Host: ${host}:${port}`);
  Logger.info(`  Database: ${database}`);
  Logger.info(`  Username: ${args.username}`);

  // Prompt for password
  const password = await promptSecret('Password: ');

  if (!password) {
    throw new Error('Password is required');
  }

  // Add database
  await DatabaseRepo.add({
    name: args.name,
    host,
    port,
    database,
    username: args.username,
    password,
    sslMode: args.sslMode ?? 'require',
    ownerRole: args.ownerRole ?? null,
  });

  // Test connection
  Logger.info('Testing connection...');
  const test = await testConnection(args.name);
  if (!test.ok) {
    // Connection test failed, remove the database
    await DatabaseRepo.remove(args.name);
    throw new Error(`Connection test failed: ${test.error}`);
  }

  Logger.success(`✓ Database "${args.name}" registered successfully`);
}
