import { promptSecret } from '../utils/prompt-secret.js';
import { DatabaseRepo } from '../db/repos.js';
import { testConnection } from '../db-migration/connector.js';
import { Logger } from '../utils/logger.js';

export async function dbRegister(args: {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode?: 'disable' | 'require' | 'verify-full';
  ownerRole?: string;
}): Promise<void> {
  // Prompt for password
  const password = await promptSecret('Password: ');

  if (!password) {
    throw new Error('Password is required');
  }

  // Add database
  await DatabaseRepo.add({
    name: args.name,
    host: args.host,
    port: args.port,
    database: args.database,
    username: args.username,
    password,
    sslMode: args.sslMode ?? 'require',
    ownerRole: args.ownerRole ?? null,
  });

  // Test connection
  const test = await testConnection(args.name);
  if (!test.ok) {
    // Connection test failed, remove the database
    await DatabaseRepo.remove(args.name);
    throw new Error(`Connection test failed: ${test.error}`);
  }

  Logger.success(`Database "${args.name}" registered successfully`);
}
