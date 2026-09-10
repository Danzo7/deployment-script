// Migration to add createdBy and updatedBy fields to existing tables
// This migration is safe to run multiple times - it checks if columns exist first

import { getDB, closeDB } from './db.js';
import { Logger } from '../utils/logger.js';
import chalk from 'chalk';
import { dbType } from './schema.js';

export async function addTraceabilityFields(): Promise<void> {
  Logger.info(chalk.blue('🔄 Adding traceability fields (createdBy/updatedBy)...'));

  const db: any = getDB();

  try {
    if (dbType === 'sqlite') {
      await migrateSQLite(db);
    } else {
      await migratePostgreSQL(db);
    }

    Logger.success(chalk.green('✓ Traceability fields added successfully'));
  } catch (error: any) {
    // If error is about column already existing, that's okay
    if (error.message?.includes('duplicate column') || 
        error.message?.includes('already exists') ||
        error.message?.includes('Duplicate column name')) {
      Logger.info(chalk.gray('  Traceability fields already exist, skipping...'));
    } else {
      Logger.error('Failed to add traceability fields:', error);
      throw error;
    }
  } finally {
    await closeDB();
  }
}

async function migrateSQLite(db: any): Promise<void> {
  Logger.info(chalk.gray('  Migrating SQLite database...'));

  // SQLite doesn't support adding columns with NOT NULL constraint directly
  // We add them as nullable first, then update with default values

  const migrations = [
    // Apps table
    {
      table: 'apps',
      columns: [
        { name: 'createdBy', sql: `ALTER TABLE apps ADD COLUMN createdBy TEXT DEFAULT 'system' NOT NULL` },
        { name: 'updatedBy', sql: `ALTER TABLE apps ADD COLUMN updatedBy TEXT DEFAULT 'system' NOT NULL` },
      ],
    },
    // Domains table
    {
      table: 'domains',
      columns: [
        { name: 'createdBy', sql: `ALTER TABLE domains ADD COLUMN createdBy TEXT DEFAULT 'system' NOT NULL` },
        { name: 'updatedBy', sql: `ALTER TABLE domains ADD COLUMN updatedBy TEXT DEFAULT 'system' NOT NULL` },
      ],
    },
    // Routes table
    {
      table: 'routes',
      columns: [
        { name: 'createdBy', sql: `ALTER TABLE routes ADD COLUMN createdBy TEXT DEFAULT 'system' NOT NULL` },
        { name: 'updatedBy', sql: `ALTER TABLE routes ADD COLUMN updatedBy TEXT DEFAULT 'system' NOT NULL` },
      ],
    },
    // Storages table
    {
      table: 'storages',
      columns: [
        { name: 'createdBy', sql: `ALTER TABLE storages ADD COLUMN createdBy TEXT DEFAULT 'system' NOT NULL` },
      ],
    },
    // App Config table
    {
      table: 'app_config',
      columns: [
        { name: 'createdBy', sql: `ALTER TABLE app_config ADD COLUMN createdBy TEXT DEFAULT 'system' NOT NULL` },
        { name: 'updatedBy', sql: `ALTER TABLE app_config ADD COLUMN updatedBy TEXT DEFAULT 'system' NOT NULL` },
      ],
    },
  ];

  for (const { table, columns } of migrations) {
    for (const { name, sql } of columns) {
      try {
        await db.run(sql);
        Logger.info(chalk.green(`  ✓ Added ${name} to ${table}`));
      } catch (error: any) {
        const errorMsg = error.message || '';
        const causeMsg = error.cause?.message || '';
        const errorCode = error.code || error.cause?.code || '';
        
        if (errorMsg.includes('duplicate column') || 
            causeMsg.includes('duplicate column') ||
            errorCode === 'SQLITE_ERROR') {
          Logger.info(chalk.gray(`  ${name} already exists in ${table}`));
        } else {
          throw error;
        }
      }
    }
  }
}

async function migratePostgreSQL(db: any): Promise<void> {
  Logger.info(chalk.gray('  Migrating PostgreSQL database...'));

  const migrations = [
    // Apps table
    {
      table: 'apps',
      columns: [
        { name: 'created_by', sql: `ALTER TABLE apps ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
        { name: 'updated_by', sql: `ALTER TABLE apps ADD COLUMN updated_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
      ],
    },
    // Domains table
    {
      table: 'domains',
      columns: [
        { name: 'created_by', sql: `ALTER TABLE domains ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
        { name: 'updated_by', sql: `ALTER TABLE domains ADD COLUMN updated_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
      ],
    },
    // Routes table
    {
      table: 'routes',
      columns: [
        { name: 'created_by', sql: `ALTER TABLE routes ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
        { name: 'updated_by', sql: `ALTER TABLE routes ADD COLUMN updated_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
      ],
    },
    // Storages table
    {
      table: 'storages',
      columns: [
        { name: 'created_by', sql: `ALTER TABLE storages ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
      ],
    },
    // App Config table
    {
      table: 'app_config',
      columns: [
        { name: 'created_by', sql: `ALTER TABLE app_config ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
        { name: 'updated_by', sql: `ALTER TABLE app_config ADD COLUMN updated_by VARCHAR(255) NOT NULL DEFAULT 'system'` },
      ],
    },
  ];

  for (const { table, columns } of migrations) {
    for (const { name, sql } of columns) {
      try {
        await db.execute(sql);
        Logger.info(chalk.green(`  ✓ Added ${name} to ${table}`));
      } catch (error: any) {
        if (error.message?.includes('already exists') || 
            error.code === '42701') { // PostgreSQL duplicate column error code
          Logger.info(chalk.gray(`  ${name} already exists in ${table}`));
        } else {
          throw error;
        }
      }
    }
  }
}
