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
          // Validate required fields
          const missingFields: string[] = [];
          if (!storage.name) missingFields.push('name');
          if (!storage.linkName) missingFields.push('linkName');
          if (!storage.path) missingFields.push('path');
          
          if (missingFields.length > 0) {
            Logger.error(`❌ CANNOT migrate storage - missing required fields: ${missingFields.join(', ')}`);
            Logger.error(`   Storage data: ${JSON.stringify(storage)}`);
            throw new Error(`Cannot migrate storage without required fields: ${missingFields.join(', ')}`);
          }
          
          await StorageRepo.add({
            name: storage.name,
            linkName: storage.linkName,
            path: storage.path,
          });
          stats.storages++;
          Logger.info(chalk.green(`  ✓ Migrated storage: ${storage.name}`));
        } catch (error) {
          Logger.error(`❌ Failed to migrate storage ${storage.name}:`, error);
          throw error; // Stop migration if any storage fails
        }
      }
    }

    // Migrate Apps
    if (legacyData.apps && Array.isArray(legacyData.apps)) {
      for (const app of legacyData.apps) {
        try {
          // Validate required fields - MUST have all of these
          const missingFields: string[] = [];
          if (!app.name) missingFields.push('name');
          if (!app.appDir) missingFields.push('appDir');
          if (!app.repo) missingFields.push('repo');
          if (!app.branch) missingFields.push('branch');
          if (!app.projectType) missingFields.push('projectType');
          if (app.port === undefined || app.port === null) missingFields.push('port');
          
          if (missingFields.length > 0) {
            Logger.error(`❌ CANNOT migrate app "${app.name || 'unknown'}" - missing required fields: ${missingFields.join(', ')}`);
            Logger.error(`   App data: ${JSON.stringify(app)}`);
            throw new Error(`Cannot migrate app without required fields: ${missingFields.join(', ')}`);
          }
          
          const createdApp = await AppRepo.add({
            name: app.name,
            appDir: app.appDir,
            port: app.port,
            instances: app.instances ?? 1,
            repo: app.repo,
            branch: app.branch,
            vcsType: app.vcsType || 'git',
            builds: app.builds || [],
            activeBuild: app.activeBuild,
            projectType: app.projectType,
            projectDir: app.projectDir,
            lastDeployedCommit: app.lastDeployedCommit,
          } as any);
          
          // Update with lastDeploy if it exists
          if (app.lastDeploy) {
            await AppRepo.update(app.name, {
              lastDeploy: new Date(app.lastDeploy),
            });
          }
          
          stats.apps++;
          Logger.info(chalk.green(`  ✓ Migrated app: ${app.name}`));

          // Migrate linkedStorages to app_storage junction table
          if (app.linkedStorages && Array.isArray(app.linkedStorages)) {
            for (const storageName of app.linkedStorages) {
              try {
                const storage = await StorageRepo.findByName(storageName);
                await AppRepo.linkStorage(createdApp.id, storage.id);
                stats.appStorageLinks++;
              } catch (error) {
                Logger.warn(`  ⚠ Failed to link storage ${storageName} to app ${app.name}:`, error);
              }
            }
          }
        } catch (error) {
          Logger.error(`❌ Failed to migrate app ${app.name || 'unknown'}:`, error);
          throw error; // Stop migration if any app fails
        }
      }
    }

    // Migrate Domains
    if (legacyData.domains && Array.isArray(legacyData.domains)) {
      for (const domain of legacyData.domains) {
        try {
          if (!domain.name) {
            Logger.error(`❌ CANNOT migrate domain - missing required field: name`);
            throw new Error('Cannot migrate domain without name');
          }
          
          await DomainRepo.add({ name: domain.name });
          // Update with additional fields
          await DomainRepo.update(domain.name, {
            ssl: domain.ssl || { mode: 'none' },
            headers: domain.headers,
            lastPushedAt: domain.lastPushedAt ? new Date(domain.lastPushedAt) : undefined,
            configPath: domain.configPath,
            lastCompiledAt: domain.lastCompiledAt ? new Date(domain.lastCompiledAt) : undefined,
          });
          stats.domains++;
          Logger.info(chalk.green(`  ✓ Migrated domain: ${domain.name}`));
        } catch (error) {
          Logger.error(`❌ Failed to migrate domain ${domain.name}:`, error);
          throw error; // Stop migration if any domain fails
        }
      }
    }

    // Migrate Routes (convert appName to appId)
    if (legacyData.routes && Array.isArray(legacyData.routes)) {
      for (const route of legacyData.routes) {
        try {
          if (!route.appName || !route.domainId || route.path === undefined) {
            Logger.warn(`⚠ Skipping route ${route.id} - missing required fields (appName: ${route.appName}, domainId: ${route.domainId}, path: ${route.path})`);
            continue; // Routes can be skipped if invalid
          }
          
          // Find the app by name to get its ID
          const app = await AppRepo.findByName(route.appName);
          
          await RouteRepo.add({
            domainId: route.domainId,
            path: route.path,
            appId: app.id,
          });
          stats.routes++;
          Logger.info(chalk.green(`  ✓ Migrated route: ${route.appName} on domain ${route.domainId}`));
        } catch (error) {
          Logger.warn(`⚠ Failed to migrate route ${route.id} (app: ${route.appName}, domain: ${route.domainId}):`, error);
          // Don't throw - routes can be recreated manually if needed
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
