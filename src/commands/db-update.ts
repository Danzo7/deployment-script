import { promptSecret } from '../utils/prompt-secret.js';
import { DatabaseRepo } from '../db/repos.js';
import { testConnection } from '../db-migration/connector.js';
import { Logger } from '../utils/logger.js';

export async function dbUpdate(args: {
  name: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslMode?: 'disable' | 'require' | 'verify-full';
  ownerRole?: string;
}): Promise<void> {
  const updateData: any = {};

  // Build update data object with only provided fields
  if (args.host !== undefined) updateData.host = args.host;
  if (args.port !== undefined) updateData.port = args.port;
  if (args.database !== undefined) updateData.database = args.database;
  if (args.username !== undefined) updateData.username = args.username;
  if (args.sslMode !== undefined) updateData.sslMode = args.sslMode;
  if (args.ownerRole !== undefined) updateData.ownerRole = args.ownerRole;

  // If password flag is present (even if empty string), prompt for new password
  if ('password' in args) {
    const password = await promptSecret('New password: ');
    if (!password) {
      throw new Error('Password cannot be empty');
    }
    updateData.password = password;
  }

  // Update database
  await DatabaseRepo.update(args.name, updateData);

  // If any connection details changed, test connection
  const connectionDetailsChanged =
    args.host !== undefined ||
    args.port !== undefined ||
    args.database !== undefined ||
    args.username !== undefined ||
    'password' in args ||
    args.sslMode !== undefined ||
    args.ownerRole !== undefined;

  if (connectionDetailsChanged) {
    const test = await testConnection(args.name);
    if (!test.ok) {
      Logger.warn(
        `Database updated but connection test failed: ${test.error}`
      );
    }
  }

  Logger.success(`Database "${args.name}" updated successfully`);
}
