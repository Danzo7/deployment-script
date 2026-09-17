import { Logger } from '../utils/logger.js';

export async function dbMigrate(args: {
  name: string;
  key: string;
  type?: 'generated' | 'manual';
}): Promise<void> {
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');
  const { DatabaseRepo, MigrationRepo } = await import('../db/repos.js');

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

  await launchPage({
    pageId: PageId.DbMigrate,
    params: {
      name: args.name,
      key: args.key,
      type: args.type,
      initialText,
    },
    fullScreen: true,
    onResult: (migrationExecuted: boolean) => {
      if (migrationExecuted) {
        Logger.success('Migration completed');
      }
    },
  });
}
