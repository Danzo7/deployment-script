import { existsSync, readFileSync, copyFileSync } from 'fs';
import path from 'path';
import { APP_DIR } from '../constants.js';
import { Logger } from '../utils/logger.js';
import { initializeDB as initNewDB, closeDB } from '../db/db.js';
import { AppRepo, StorageRepo, DomainRepo, RouteRepo, AppConfigRepo } from '../db/repos.js';
import chalk from 'chalk';

interface LegacyDatabaseSchema {
  apps: any[];
  storages: any[];
  domains: any[];
  routes: any[];
}

/**
 * Ensure all apps have app_config entries
 * This handles both new apps and existing apps without configs
 */
async function ensureAppConfigs() {
  Logger.info(chalk.blue('🔄 Ensuring all apps have config entries...'));
  
  const apps = await AppRepo.getAll();
  let created = 0;
  let skipped = 0;

  for (const app of apps) {
    try {
      const existingConfig = await AppConfigRepo.findByAppId(app.id);
      
      if (existingConfig) {
        skipped++;
        continue;
      }

      // Create default config for apps without one
      await AppConfigRepo.create({
        appId: app.id,
        instances: 1,
        maxMemory: '250M',
      });

      Logger.info(chalk.gray(`  → Created config for: ${app.name} (instances: 1, memory: 250M)`));
      created++;
    } catch (error) {
      Logger.warn(`  ⚠ Failed to create config for app ${app.name}:`, error);
    }
  }

  if (created > 0) {
    Logger.info(chalk.green(`✓ Created ${created} new app config(s)`));
  }
  if (skipped > 0) {
    Logger.info(chalk.gray(`  ${skipped} app(s) already had configs`));
  }
}

/**
 * Migrate from legacy lowdb JSON file to Drizzle (SQLite or PostgreSQL)
 * Also ensures all apps have app_config entries
 */
export async function migrateFromJSON() {
  Logger.info('Initializing database...');
  await initNewDB();
  Logger.info(chalk.green('✓ Database initialized successfully'));

  const jsonPath = path.resolve(APP_DIR, 'db.json');
  const hasJsonToMigrate = existsSync(jsonPath);

  // If no JSON file exists, just ensure all apps have configs
  if (!hasJsonToMigrate) {
    Logger.info(chalk.blue('No legacy JSON database found.'));
    await ensureAppConfigs();
    await closeDB();
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

  const stats = {
    apps: 0,
    storages: 0,
    appStorageLinks: 0,
    domains: 0,
    routes: 0,
  };

  // ID mapping: old ID -> new ID
  const appIdMap = new Map<string, string | number>();
  const storageIdMap = new Map<string, string | number>();
  const domainIdMap = new Map<string, string | number>();
  const domainNameMap = new Map<string, string>(); // old ID -> domain name

  try {
    // Migrate Storages first (apps may reference them)
    if (legacyData.storages && Array.isArray(legacyData.storages)) {
      for (const storage of legacyData.storages) {
        try {
          // Validate required fields
          const missingFields: string[] = [];
          if (!storage.name) missingFields.push('name');
          if (!storage.path) missingFields.push('path');

          if (missingFields.length > 0) {
            Logger.error(
              `❌ CANNOT migrate storage - missing required fields: ${missingFields.join(', ')}`
            );
            Logger.error(`   Storage data: ${JSON.stringify(storage)}`);
            throw new Error(
              `Cannot migrate storage without required fields: ${missingFields.join(', ')}`
            );
          }

          const createdStorage = await StorageRepo.add({
            name: storage.name,
            linkName: storage.linkName ?? null,
            path: storage.path,
          });

          // Map old ID to new ID
          if (storage.id) {
            storageIdMap.set(storage.id.toString(), createdStorage.id);
          }

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
          if (app.port === undefined || app.port === null)
            missingFields.push('port');

          if (missingFields.length > 0) {
            Logger.error(
              `❌ CANNOT migrate app "${app.name || 'unknown'}" - missing required fields: ${missingFields.join(', ')}`
            );
            Logger.error(`   App data: ${JSON.stringify(app)}`);
            throw new Error(
              `Cannot migrate app without required fields: ${missingFields.join(', ')}`
            );
          }

          const createdApp = await AppRepo.add({
            name: app.name,
            appDir: app.appDir,
            port: app.port,
            repo: app.repo,
            branch: app.branch ?? 'main',
            vcsType: app.vcsType || 'git',
            builds: app.builds || [],
            activeBuild: app.activeBuild,
            projectType: app.projectType ?? 'nextjs',
            projectDir: app.projectDir,
            lastDeployedCommit: app.lastDeployedCommit,
          } as any);

          // Map old ID to new ID
          if (app.id) {
            appIdMap.set(app.id.toString(), createdApp.id);
          }

          // Update with lastDeploy if it exists
          if (app.lastDeploy) {
            await AppRepo.update(app.name, {
              lastDeploy: new Date(app.lastDeploy),
            });
          }

          stats.apps++;
          Logger.info(chalk.green(`  ✓ Migrated app: ${app.name}`));

          // Create default app config
          await AppConfigRepo.create({
            appId: createdApp.id,
            instances: app.instances ?? 1,
            maxMemory: '250M',
          });
          Logger.info(chalk.gray(`    → Created app config (instances: ${app.instances ?? 1}, memory: 250M)`));

          // Migrate linkedStorages to app_storage junction table
          if (app.linkedStorages && Array.isArray(app.linkedStorages)) {
            for (const storageName of app.linkedStorages) {
              try {
                const storage = await StorageRepo.findByName(storageName);
                await AppRepo.linkStorage(createdApp.id, storage.id);
                stats.appStorageLinks++;
                Logger.info(chalk.gray(`    → Linked storage: ${storageName}`));
              } catch (error) {
                Logger.warn(
                  `  ⚠ Failed to link storage ${storageName} to app ${app.name}:`,
                  error
                );
              }
            }
          }
        } catch (error) {
          Logger.error(
            `❌ Failed to migrate app ${app.name || 'unknown'}:`,
            error
          );
          throw error; // Stop migration if any app fails
        }
      }
    }

    // Migrate Domains
    if (legacyData.domains && Array.isArray(legacyData.domains)) {
      for (const domain of legacyData.domains) {
        try {
          if (!domain.name) {
            Logger.error(
              `❌ CANNOT migrate domain - missing required field: name`
            );
            throw new Error('Cannot migrate domain without name');
          }

          const createdDomain = await DomainRepo.add({ name: domain.name });

          // Map old ID to new ID and store domain name
          if (domain.id) {
            domainIdMap.set(domain.id.toString(), createdDomain.id);
            domainNameMap.set(domain.id.toString(), domain.name);
          }

          // Update with additional fields
          await DomainRepo.update(domain.name, {
            ssl: domain.ssl || { mode: 'none' },
            headers: domain.headers,
            lastPushedAt: domain.lastPushedAt
              ? new Date(domain.lastPushedAt)
              : undefined,
            configPath: domain.configPath,
            lastCompiledAt: domain.lastCompiledAt
              ? new Date(domain.lastCompiledAt)
              : undefined,
          });
          stats.domains++;
          Logger.info(chalk.green(`  ✓ Migrated domain: ${domain.name}`));
        } catch (error) {
          Logger.error(`❌ Failed to migrate domain ${domain.name}:`, error);
          throw error; // Stop migration if any domain fails
        }
      }
    }

    // Migrate Routes (convert appName to appId and map domain IDs)
    if (legacyData.routes && Array.isArray(legacyData.routes)) {
      for (const route of legacyData.routes) {
        try {
          // Check if route has required fields
          const routeDomainIdentifier = route.domainName || route.domainId;
          if (
            !route.appName ||
            !routeDomainIdentifier ||
            route.path === undefined
          ) {
            Logger.warn(
              `⚠ Skipping route ${route.id} - missing required fields (appName: ${route.appName}, domainId/domainName: ${routeDomainIdentifier}, path: ${route.path})`
            );
            continue;
          }

          let newDomainId: string | number | undefined;
          let domainName = 'unknown';

          // If route has domainName, use it directly
          if (route.domainName) {
            domainName = route.domainName;
            const domain = await DomainRepo.findByName(route.domainName);
            newDomainId = domain.id;
          }
          // Otherwise, map the old domainId to new domainId
          else if (route.domainId) {
            newDomainId = domainIdMap.get(route.domainId.toString());
            domainName =
              domainNameMap.get(route.domainId.toString()) || 'unknown';

            if (!newDomainId) {
              Logger.warn(
                `⚠ Skipping route ${route.id} - domain ID ${route.domainId} not found in migration map`
              );
              continue;
            }
          }

          // Find the app by name to get its new ID
          const app = await AppRepo.findByName(route.appName);

          const createdRoute = await RouteRepo.add({
            domainId: newDomainId!,
            path: route.path,
            appId: app.id,
          });

          // Update route headers if they exist
          if (route.headers) {
            await RouteRepo.update(createdRoute.id, {
              headers: route.headers,
            });
          }

          stats.routes++;
          Logger.info(
            chalk.green(
              `  ✓ Migrated route: ${domainName}${route.path ? '/' + route.path : '/'} → ${route.appName}${route.headers ? ' (with headers)' : ''}`
            )
          );
        } catch (error) {
          Logger.warn(
            `⚠ Failed to migrate route ${route.id} (app: ${route.appName}):`,
            error
          );
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

    Logger.info(chalk.cyan(`\nRelationships Preserved:`));
    Logger.info(
      `  ✓ Storage → App links:  ${stats.appStorageLinks} connections maintained`
    );
    Logger.info(
      `  ✓ Route → Domain:       ${stats.routes} routes linked to their domains`
    );
    Logger.info(
      `  ✓ Route → App:          ${stats.routes} routes linked to their apps`
    );
    Logger.info(
      `  ✓ ID Mappings:          ${appIdMap.size} apps, ${domainIdMap.size} domains, ${storageIdMap.size} storages`
    );

    Logger.info(
      chalk.yellow(`\n⚠️  The legacy db.json file has been backed up to:`)
    );
    Logger.info(chalk.gray(`   ${backupPath}`));
    Logger.info(
      chalk.yellow(
        `\n   You can safely delete db.json after verifying the migration.`
      )
    );

    // Ensure all apps have configs (in case any were missed or added later)
    Logger.info('');
    await ensureAppConfigs();
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
