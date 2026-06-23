import { existsSync, readFileSync, copyFileSync } from 'fs';
import path from 'path';
import { APP_DIR } from '../constants.js';
import { Logger } from '../utils/logger.js';
import { initializeDB as initNewDB, closeDB } from '../db/db.js';
import { AppRepo, StorageRepo, DomainRepo, RouteRepo } from '../db/repos.js';
import chalk from 'chalk';

interface LegacyDatabaseSchema {
  apps: any[];
  storages: any[];
  domains: any[];
  routes: any[];
}

/**
 * Migrate from legacy lowdb JSON file to Drizzle (SQLite or PostgreSQL)
 */
export async function migrateFromJSON() {
  const jsonPath = path.resolve(APP_DIR, 'db.json');
  
  if (!existsSync(jsonPath)) {
    Logger.info('No legacy db.json file found. Skipping migration.');
    return;
  }

  Logger.info(chalk.blue('🔄 Starting database migration from JSON to SQL...'));

  // Create backup
  const backupPath = path.resolve(APP_DIR, `db.json.backup-${Date.now()}`);
  copyFileSync(jsonPath, backupPath);
  Logger.info(chalk.green(`✓ Created backup at ${backupPath}`));

  // Read legacy JSON data
  let legacyData: LegacyDatabaseSchema;
  try {
    const fileContent = readFileSync(jsonPath, 'utf-8');
    legacyData = JSON.parse(fileContent);
  } catch (error) {
    Logger.error('Failed to read or parse db.json:', error);
    throw error;
  }

  // Initialize new database
  await initNewDB();
  Logger.info(chalk.green('✓ Initialized new database'));

  const stats = {
    apps: 0,
    storages: 0,
    appStorageLinks: 0,
    domains: 0,
    routes: 0,
  };

  try {
    // Migrate Storages first (apps may reference them)
    if (legacyData.storages && Array.isArray(legacyData.storages)) {
      for (const storage of legacyData.storages) {
        try {
          await StorageRepo.add({
            name: storage.name,
            linkName: storage.linkName,
            path: storage.path,
          });
          stats.storages++;
        } catch (error) {
          Logger.warn(`Failed to migrate storage ${storage.name}:`, error);
        }
      }
    }

    // Migrate Apps
    if (legacyData.apps && Array.isArray(legacyData.apps)) {
      for (const app of legacyData.apps) {
        try {
          await AppRepo.add({
            id: app.id,
            name: app.name,
            appDir: app.appDir,
            port: app.port,
            instances: app.instances || 1,
            repo: app.repo,
            branch: app.branch,
            vcsType: app.vcsType || 'git',
            builds: app.builds || [],
            activeBuild: app.activeBuild,
            projectType: app.projectType,
            projectDir: app.projectDir,
            lastDeployedCommit: app.lastDeployedCommit,
            lastDeploy: app.lastDeploy,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt,
          } as any);
          stats.apps++;

          // Migrate linkedStorages to app_storage junction table
          if (app.linkedStorages && Array.isArray(app.linkedStorages)) {
            for (const storageName of app.linkedStorages) {
              try {
                const storage = await StorageRepo.findByName(storageName);
                await AppRepo.linkStorage(app.id, storage.id);
                stats.appStorageLinks++;
              } catch (error) {
                Logger.warn(`Failed to link storage ${storageName} to app ${app.name}:`, error);
              }
            }
          }
        } catch (error) {
          Logger.warn(`Failed to migrate app ${app.name}:`, error);
        }
      }
    }

    // Migrate Domains
    if (legacyData.domains && Array.isArray(legacyData.domains)) {
      for (const domain of legacyData.domains) {
        try {
          await DomainRepo.add({ name: domain.name });
          // Update with additional fields
          await DomainRepo.update(domain.name, {
            ssl: domain.ssl || { mode: 'none' },
            headers: domain.headers,
            lastPushedAt: domain.lastPushedAt,
            configPath: domain.configPath,
            lastCompiledAt: domain.lastCompiledAt,
            createdAt: domain.createdAt,
            updatedAt: domain.updatedAt,
          });
          stats.domains++;
        } catch (error) {
          Logger.warn(`Failed to migrate domain ${domain.name}:`, error);
        }
      }
    }

    // Migrate Routes (convert appName to appId)
    if (legacyData.routes && Array.isArray(legacyData.routes)) {
      for (const route of legacyData.routes) {
        try {
          // Find the app by name to get its ID
          const app = await AppRepo.findByName(route.appName);
          
          await RouteRepo.add({
            domainId: route.domainId,
            path: route.path,
            appId: app.id,
          });
          stats.routes++;
        } catch (error) {
          Logger.warn(`Failed to migrate route ${route.id} (app: ${route.appName}):`, error);
        }
      }
    }

    Logger.info(chalk.green('\n✅ Migration completed successfully!'));
    Logger.info(chalk.cyan(`\nMigration Statistics:`));
    Logger.info(`  Apps:          ${stats.apps}`);
    Logger.info(`  Storages:      ${stats.storages}`);
    Logger.info(`  App-Storages:  ${stats.appStorageLinks}`);
    Logger.info(`  Domains:       ${stats.domains}`);
    Logger.info(`  Routes:        ${stats.routes}`);
    
    Logger.info(chalk.yellow(`\n⚠️  The legacy db.json file has been backed up to:`));
    Logger.info(chalk.gray(`   ${backupPath}`));
    Logger.info(chalk.yellow(`\n   You can safely delete db.json after verifying the migration.`));

  } catch (error) {
    Logger.error('Migration failed:', error);
    throw error;
  } finally {
    await closeDB();
  }
}

/**
 * Check if migration is needed
 */
export function isMigrationNeeded(): boolean {
  const jsonPath = path.resolve(APP_DIR, 'db.json');
  const sqlitePath = path.resolve(APP_DIR, 'db.sqlite');
  
  // Migration needed if JSON exists and SQLite doesn't
  return existsSync(jsonPath) && !existsSync(sqlitePath);
}
