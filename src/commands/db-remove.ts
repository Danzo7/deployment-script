import { getDB } from '../db/db.js';
import { DatabaseRepo } from '../db/repos.js';
import { migrationsTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { Logger } from '../utils/logger.js';

export async function dbRemove(args: { name: string }): Promise<void> {
  // Find the database
  const database = await DatabaseRepo.findByName(args.name);

  // Check if any migrations reference this database
  const db: any = getDB();
  const migrations = await db
    .select()
    .from(migrationsTable)
    .where(eq(migrationsTable.databaseId, database.id));

  if (migrations.length > 0) {
    throw new Error(
      `Cannot remove database "${args.name}": ${migrations.length} migration(s) exist. ` +
        `Delete migrations first or use --force flag.`
    );
  }

  // Remove database
  await DatabaseRepo.remove(args.name);

  Logger.success(`Database "${args.name}" removed successfully`);
}
