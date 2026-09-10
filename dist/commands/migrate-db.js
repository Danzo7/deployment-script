import { existsSync, readFileSync, copyFileSync } from "fs";
import path from "path";
import { APP_DIR } from "../constants.js";
import { Logger } from "../utils/logger.js";
import { initializeDB as initNewDB, closeDB } from "../db/db.js";
import { AppRepo, StorageRepo, DomainRepo, RouteRepo, AppConfigRepo } from "../db/repos.js";
import { addTraceabilityFields } from "../db/add-traceability-migration.js";
import chalk from "chalk";
async function ensureAppConfigs() {
  Logger.info(chalk.blue("\u{1F504} Ensuring all apps have config entries..."));
  try {
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
        await AppConfigRepo.create({
          appId: app.id,
          instances: 1,
          maxMemory: "250M"
        });
        Logger.info(chalk.gray(`  \u2192 Created config for: ${app.name} (instances: 1, memory: 250M)`));
        created++;
      } catch (error) {
        Logger.warn(`  \u26A0 Failed to create config for app ${app.name}:`, error);
      }
    }
    if (created > 0) {
      Logger.info(chalk.green(`\u2713 Created ${created} new app config(s)`));
    }
    if (skipped > 0) {
      Logger.info(chalk.gray(`  ${skipped} app(s) already had configs`));
    }
  } catch (error) {
    if (error.message?.includes("no such column") || error.message?.includes("createdBy")) {
      Logger.info(chalk.yellow("  \u26A0 Skipping config check - database schema needs migration first"));
    } else {
      throw error;
    }
  }
}
async function migrateFromJSON() {
  Logger.info("Initializing database...");
  await initNewDB();
  Logger.info(chalk.green("\u2713 Database initialized successfully"));
  const jsonPath = path.resolve(APP_DIR, "db.json");
  const hasJsonToMigrate = existsSync(jsonPath);
  if (!hasJsonToMigrate) {
    Logger.info(chalk.blue("No legacy JSON database found."));
    await closeDB();
    Logger.info("");
    await addTraceabilityFields();
    await initNewDB();
    await ensureAppConfigs();
    await closeDB();
    return;
  }
  Logger.info(chalk.blue("\u{1F504} Starting database migration from JSON to SQL..."));
  const backupPath = path.resolve(APP_DIR, `db.json.backup-${Date.now()}`);
  copyFileSync(jsonPath, backupPath);
  Logger.info(chalk.green(`\u2713 Created backup at ${backupPath}`));
  let legacyData;
  try {
    const fileContent = readFileSync(jsonPath, "utf-8");
    legacyData = JSON.parse(fileContent);
  } catch (error) {
    Logger.error("Failed to read or parse db.json:", error);
    throw error;
  }
  const stats = {
    apps: 0,
    storages: 0,
    appStorageLinks: 0,
    domains: 0,
    routes: 0
  };
  const appIdMap = /* @__PURE__ */ new Map();
  const storageIdMap = /* @__PURE__ */ new Map();
  const domainIdMap = /* @__PURE__ */ new Map();
  const domainNameMap = /* @__PURE__ */ new Map();
  try {
    if (legacyData.storages && Array.isArray(legacyData.storages)) {
      for (const storage of legacyData.storages) {
        try {
          const missingFields = [];
          if (!storage.name) missingFields.push("name");
          if (!storage.path) missingFields.push("path");
          if (missingFields.length > 0) {
            Logger.error(
              `\u274C CANNOT migrate storage - missing required fields: ${missingFields.join(", ")}`
            );
            Logger.error(`   Storage data: ${JSON.stringify(storage)}`);
            throw new Error(
              `Cannot migrate storage without required fields: ${missingFields.join(", ")}`
            );
          }
          const createdStorage = await StorageRepo.add({
            name: storage.name,
            linkName: storage.linkName ?? null,
            path: storage.path
          });
          if (storage.id) {
            storageIdMap.set(storage.id.toString(), createdStorage.id);
          }
          stats.storages++;
          Logger.info(chalk.green(`  \u2713 Migrated storage: ${storage.name}`));
        } catch (error) {
          Logger.error(`\u274C Failed to migrate storage ${storage.name}:`, error);
          throw error;
        }
      }
    }
    if (legacyData.apps && Array.isArray(legacyData.apps)) {
      for (const app of legacyData.apps) {
        try {
          const missingFields = [];
          if (!app.name) missingFields.push("name");
          if (!app.appDir) missingFields.push("appDir");
          if (!app.repo) missingFields.push("repo");
          if (app.port === void 0 || app.port === null)
            missingFields.push("port");
          if (missingFields.length > 0) {
            Logger.error(
              `\u274C CANNOT migrate app "${app.name || "unknown"}" - missing required fields: ${missingFields.join(", ")}`
            );
            Logger.error(`   App data: ${JSON.stringify(app)}`);
            throw new Error(
              `Cannot migrate app without required fields: ${missingFields.join(", ")}`
            );
          }
          const createdApp = await AppRepo.add({
            name: app.name,
            appDir: app.appDir,
            port: app.port,
            repo: app.repo,
            branch: app.branch ?? "main",
            vcsType: app.vcsType || "git",
            builds: app.builds || [],
            activeBuild: app.activeBuild,
            projectType: app.projectType ?? "nextjs",
            projectDir: app.projectDir,
            lastDeployedCommit: app.lastDeployedCommit
          });
          if (app.id) {
            appIdMap.set(app.id.toString(), createdApp.id);
          }
          if (app.lastDeploy) {
            await AppRepo.update(app.name, {
              lastDeploy: new Date(app.lastDeploy)
            });
          }
          stats.apps++;
          Logger.info(chalk.green(`  \u2713 Migrated app: ${app.name}`));
          await AppConfigRepo.create({
            appId: createdApp.id,
            instances: app.instances ?? 1,
            maxMemory: "250M"
          });
          Logger.info(chalk.gray(`    \u2192 Created app config (instances: ${app.instances ?? 1}, memory: 250M)`));
          if (app.linkedStorages && Array.isArray(app.linkedStorages)) {
            for (const storageName of app.linkedStorages) {
              try {
                const storage = await StorageRepo.findByName(storageName);
                await AppRepo.linkStorage(createdApp.id, storage.id);
                stats.appStorageLinks++;
                Logger.info(chalk.gray(`    \u2192 Linked storage: ${storageName}`));
              } catch (error) {
                Logger.warn(
                  `  \u26A0 Failed to link storage ${storageName} to app ${app.name}:`,
                  error
                );
              }
            }
          }
        } catch (error) {
          Logger.error(
            `\u274C Failed to migrate app ${app.name || "unknown"}:`,
            error
          );
          throw error;
        }
      }
    }
    if (legacyData.domains && Array.isArray(legacyData.domains)) {
      for (const domain of legacyData.domains) {
        try {
          if (!domain.name) {
            Logger.error(
              `\u274C CANNOT migrate domain - missing required field: name`
            );
            throw new Error("Cannot migrate domain without name");
          }
          const createdDomain = await DomainRepo.add({ name: domain.name });
          if (domain.id) {
            domainIdMap.set(domain.id.toString(), createdDomain.id);
            domainNameMap.set(domain.id.toString(), domain.name);
          }
          await DomainRepo.update(domain.name, {
            ssl: domain.ssl || { mode: "none" },
            headers: domain.headers,
            lastPushedAt: domain.lastPushedAt ? new Date(domain.lastPushedAt) : void 0,
            configPath: domain.configPath,
            lastCompiledAt: domain.lastCompiledAt ? new Date(domain.lastCompiledAt) : void 0
          });
          stats.domains++;
          Logger.info(chalk.green(`  \u2713 Migrated domain: ${domain.name}`));
        } catch (error) {
          Logger.error(`\u274C Failed to migrate domain ${domain.name}:`, error);
          throw error;
        }
      }
    }
    if (legacyData.routes && Array.isArray(legacyData.routes)) {
      for (const route of legacyData.routes) {
        try {
          const routeDomainIdentifier = route.domainName || route.domainId;
          if (!route.appName || !routeDomainIdentifier || route.path === void 0) {
            Logger.warn(
              `\u26A0 Skipping route ${route.id} - missing required fields (appName: ${route.appName}, domainId/domainName: ${routeDomainIdentifier}, path: ${route.path})`
            );
            continue;
          }
          let newDomainId;
          let domainName = "unknown";
          if (route.domainName) {
            domainName = route.domainName;
            const domain = await DomainRepo.findByName(route.domainName);
            newDomainId = domain.id;
          } else if (route.domainId) {
            newDomainId = domainIdMap.get(route.domainId.toString());
            domainName = domainNameMap.get(route.domainId.toString()) || "unknown";
            if (!newDomainId) {
              Logger.warn(
                `\u26A0 Skipping route ${route.id} - domain ID ${route.domainId} not found in migration map`
              );
              continue;
            }
          }
          const app = await AppRepo.findByName(route.appName);
          const createdRoute = await RouteRepo.add({
            domainId: newDomainId,
            path: route.path,
            appId: app.id
          });
          if (route.headers) {
            await RouteRepo.update(createdRoute.id, {
              headers: route.headers
            });
          }
          stats.routes++;
          Logger.info(
            chalk.green(
              `  \u2713 Migrated route: ${domainName}${route.path ? "/" + route.path : "/"} \u2192 ${route.appName}${route.headers ? " (with headers)" : ""}`
            )
          );
        } catch (error) {
          Logger.warn(
            `\u26A0 Failed to migrate route ${route.id} (app: ${route.appName}):`,
            error
          );
        }
      }
    }
    Logger.info(chalk.green("\n\u2705 Migration completed successfully!"));
    Logger.info(chalk.cyan(`
Migration Statistics:`));
    Logger.info(`  Apps:          ${stats.apps}`);
    Logger.info(`  Storages:      ${stats.storages}`);
    Logger.info(`  App-Storages:  ${stats.appStorageLinks}`);
    Logger.info(`  Domains:       ${stats.domains}`);
    Logger.info(`  Routes:        ${stats.routes}`);
    Logger.info(chalk.cyan(`
Relationships Preserved:`));
    Logger.info(
      `  \u2713 Storage \u2192 App links:  ${stats.appStorageLinks} connections maintained`
    );
    Logger.info(
      `  \u2713 Route \u2192 Domain:       ${stats.routes} routes linked to their domains`
    );
    Logger.info(
      `  \u2713 Route \u2192 App:          ${stats.routes} routes linked to their apps`
    );
    Logger.info(
      `  \u2713 ID Mappings:          ${appIdMap.size} apps, ${domainIdMap.size} domains, ${storageIdMap.size} storages`
    );
    Logger.info(
      chalk.yellow(`
\u26A0\uFE0F  The legacy db.json file has been backed up to:`)
    );
    Logger.info(chalk.gray(`   ${backupPath}`));
    Logger.info(
      chalk.yellow(
        `
   You can safely delete db.json after verifying the migration.`
      )
    );
    await closeDB();
    Logger.info("");
    await addTraceabilityFields();
    await initNewDB();
    await ensureAppConfigs();
  } catch (error) {
    Logger.error("Migration failed:", error);
    throw error;
  } finally {
    await closeDB();
  }
}
function isMigrationNeeded() {
  const jsonPath = path.resolve(APP_DIR, "db.json");
  const sqlitePath = path.resolve(APP_DIR, "db.sqlite");
  return existsSync(jsonPath) && !existsSync(sqlitePath);
}
export {
  isMigrationNeeded,
  migrateFromJSON
};
