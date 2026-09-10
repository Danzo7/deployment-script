import { getDB } from "./db.js";
import { eq, and } from "drizzle-orm";
import {
  appsTable,
  storagesTable,
  domainsTable,
  routesTable,
  appStorageTable,
  appConfigTable,
  dbType
} from "./schema.js";
function serializeJSON(data) {
  if (dbType === "sqlite") {
    return JSON.stringify(data);
  }
  return data;
}
function deserializeJSON(data) {
  if (!data) return void 0;
  if (dbType === "sqlite" && typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return void 0;
    }
  }
  return data;
}
function toDate(timestamp) {
  if (!timestamp) return void 0;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === "number") return new Date(timestamp * 1e3);
  return new Date(timestamp);
}
function mapToApp(row) {
  return {
    id: row.id,
    name: row.name,
    appDir: row.appDir,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    createdBy: row.createdBy || "system",
    updatedBy: row.updatedBy || "system",
    port: row.port,
    repo: row.repo,
    branch: row.branch,
    vcsType: row.vcsType,
    lastDeploy: toDate(row.lastDeploy),
    builds: deserializeJSON(row.builds) || [],
    activeBuild: row.activeBuild,
    projectType: row.projectType,
    projectDir: row.projectDir,
    lastDeployedCommit: deserializeJSON(
      row.lastDeployedCommit
    )
  };
}
function mapToStorage(row) {
  return {
    id: row.id,
    name: row.name,
    linkName: row.linkName ?? null,
    path: row.path,
    createdAt: toDate(row.createdAt),
    createdBy: row.createdBy || "system"
  };
}
function mapToDomain(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    createdBy: row.createdBy || "system",
    updatedBy: row.updatedBy || "system",
    ssl: deserializeJSON(row.ssl) || { mode: "none" },
    headers: deserializeJSON(row.headers),
    lastPushedAt: toDate(row.lastPushedAt),
    configPath: row.configPath,
    lastCompiledAt: toDate(row.lastCompiledAt)
  };
}
function mapToRoute(row) {
  return {
    id: row.id,
    domainId: row.domainId,
    path: row.path,
    appId: row.appId,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    createdBy: row.createdBy || "system",
    updatedBy: row.updatedBy || "system",
    headers: deserializeJSON(row.headers)
  };
}
const AppRepo = {
  getAll: async () => {
    const db = getDB();
    const rows = await db.select().from(appsTable);
    return rows.map(mapToApp);
  },
  /**
   * Get all apps with their storages eagerly loaded via database join
   */
  getAllWithStorages: async () => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "appsTablePostgres" : "appsTableSqlite"].findMany({
      with: {
        appStorages: {
          with: {
            storage: true
          }
        }
      }
    });
    return rows.map((row) => {
      const app = mapToApp(row);
      const storages = (row.appStorages || []).map(
        (as) => mapToStorage(as.storage)
      );
      return { ...app, storages };
    });
  },
  /**
   * Get all apps with their storages AND routes (with domains) eagerly loaded via database joins
   * This is optimized for list operations that need complete app data in a single query
   */
  getAllWithStoragesAndRoutes: async () => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "appsTablePostgres" : "appsTableSqlite"].findMany({
      with: {
        appStorages: {
          with: {
            storage: true
          }
        },
        routes: {
          with: {
            domain: true
          }
        }
      }
    });
    return rows.map((row) => {
      const app = mapToApp(row);
      const storages = (row.appStorages || []).map(
        (as) => mapToStorage(as.storage)
      );
      const routes = (row.routes || []).map((r) => {
        const route = mapToRoute(r);
        const domain = mapToDomain(r.domain);
        return { ...route, app, domain };
      });
      return { ...app, storages, routes };
    });
  },
  findById: async (id) => {
    const db = getDB();
    const rows = await db.select().from(appsTable).where(eq(appsTable.id, id));
    if (rows.length === 0) {
      throw new Error("App not found");
    }
    return mapToApp(rows[0]);
  },
  findByName: async (name) => {
    const db = getDB();
    const rows = await db.select().from(appsTable).where(eq(appsTable.name, name));
    if (rows.length === 0) {
      throw new Error("App not found");
    }
    return mapToApp(rows[0]);
  },
  /**
   * Find app by name with config eagerly loaded via database join
   */
  findByNameWithConfig: async (name) => {
    const db = getDB();
    const row = await db.query[dbType === "postgres" ? "appsTablePostgres" : "appsTableSqlite"].findFirst({
      where: (apps, { eq: eq2 }) => eq2(apps.name, name),
      with: {
        config: true
      }
    });
    if (!row) {
      throw new Error("App not found");
    }
    const app = mapToApp(row);
    let config = row.config ? mapToAppConfig(row.config) : null;
    if (!config) {
      config = await AppConfigRepo.create({
        appId: app.id,
        instances: 1,
        maxMemory: "250M"
      });
    }
    return { ...app, config };
  },
  /**
   * Find app by name with storages eagerly loaded via database join
   */
  findByNameWithStorages: async (name) => {
    const db = getDB();
    const row = await db.query[dbType === "postgres" ? "appsTablePostgres" : "appsTableSqlite"].findFirst({
      where: (apps, { eq: eq2 }) => eq2(apps.name, name),
      with: {
        appStorages: {
          with: {
            storage: true
          }
        }
      }
    });
    if (!row) {
      throw new Error("App not found");
    }
    const app = mapToApp(row);
    const storages = (row.appStorages || []).map(
      (as) => mapToStorage(as.storage)
    );
    return { ...app, storages };
  },
  /**
   * Find app by name with config and storages eagerly loaded via database join
   */
  findByNameWithConfigAndStorages: async (name) => {
    const db = getDB();
    const row = await db.query[dbType === "postgres" ? "appsTablePostgres" : "appsTableSqlite"].findFirst({
      where: (apps, { eq: eq2 }) => eq2(apps.name, name),
      with: {
        config: true,
        appStorages: {
          with: {
            storage: true
          }
        }
      }
    });
    if (!row) {
      throw new Error("App not found");
    }
    const app = mapToApp(row);
    let config = row.config ? mapToAppConfig(row.config) : null;
    if (!config) {
      config = await AppConfigRepo.create({
        appId: app.id,
        instances: 1,
        maxMemory: "250M"
      });
    }
    const storages = (row.appStorages || []).map(
      (as) => mapToStorage(as.storage)
    );
    return { ...app, config, storages };
  },
  add: async (data, createdBy) => {
    const db = getDB();
    const existing = await db.select().from(appsTable).where(eq(appsTable.name, data.name));
    if (existing.length > 0) {
      throw new Error("An app with the same name already exists");
    }
    const samePort = await db.select().from(appsTable).where(eq(appsTable.port, data.port));
    if (samePort.length > 0) {
      const portApp = mapToApp(samePort[0]);
      throw new Error(
        `The port ${data.port} is already in use by ${portApp.name}`
      );
    }
    const user = createdBy || "system";
    const insertData = {
      name: data.name,
      appDir: data.appDir,
      port: data.port,
      repo: data.repo,
      branch: data.branch,
      vcsType: data.vcsType ?? "git",
      builds: serializeJSON(data.builds || []),
      activeBuild: data.activeBuild,
      projectType: data.projectType,
      projectDir: data.projectDir,
      lastDeployedCommit: serializeJSON(data.lastDeployedCommit),
      createdBy: user,
      updatedBy: user
    };
    await db.insert(appsTable).values(insertData);
    return await AppRepo.findByName(data.name);
  },
  remove: async function(name) {
    const db = getDB();
    const app = await this.findByName(name);
    await db.delete(appsTable).where(eq(appsTable.name, app.name));
    return true;
  },
  update: async function(name, updatedData, updatedBy) {
    const db = getDB();
    const app = await this.findByName(name);
    const updateFields = {
      ...updatedData
    };
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.updatedAt;
    delete updateFields.createdBy;
    updateFields.updatedBy = updatedBy || "system";
    if (updateFields.builds) {
      updateFields.builds = serializeJSON(updateFields.builds);
    }
    if (updateFields.lastDeployedCommit) {
      updateFields.lastDeployedCommit = serializeJSON(
        updateFields.lastDeployedCommit
      );
    }
    await db.update(appsTable).set(updateFields).where(eq(appsTable.name, app.name));
    return await this.findByName(name);
  },
  addBuild: async function(name, buildPath, updatedBy) {
    const app = await this.findByName(name);
    const builds = app.builds || [];
    builds.push(buildPath);
    return await this.update(name, {
      lastDeploy: /* @__PURE__ */ new Date(),
      builds,
      activeBuild: buildPath
    }, updatedBy);
  },
  resolveActiveBuild: async function(name) {
    const app = await this.findByName(name);
    if (!app.builds?.length) return void 0;
    const raw = app.activeBuild;
    if (typeof raw === "number") {
      const resolved = app.builds[raw] ?? app.builds[app.builds.length - 1];
      await this.update(name, { activeBuild: resolved });
      return resolved;
    }
    return typeof raw === "string" ? raw : app.builds[app.builds.length - 1];
  },
  updateDeployedCommit: async function(name, commit, updatedBy) {
    return await this.update(name, {
      lastDeployedCommit: commit
    }, updatedBy);
  },
  removeBuild: async function(name, buildPath, updatedBy) {
    const app = await this.findByName(name);
    const builds = (app.builds || []).filter((build) => build !== buildPath);
    return await this.update(name, { builds }, updatedBy);
  },
  /**
   * Find apps by storage using the AppStorage junction table
   */
  findByStorageId: async (storageId) => {
    const db = getDB();
    const appStorages = await db.select().from(appStorageTable).where(eq(appStorageTable.storageId, storageId));
    const apps = [];
    for (const appStorage of appStorages) {
      try {
        const app = await AppRepo.findById(appStorage.appId);
        apps.push(app);
      } catch {
      }
    }
    return apps;
  },
  /**
   * Get all storages linked to an app
   */
  getStoragesByAppId: async (appId) => {
    const db = getDB();
    const appStorages = await db.select().from(appStorageTable).where(eq(appStorageTable.appId, appId));
    if (appStorages.length === 0) return [];
    const storageIds = appStorages.map((as) => as.storageId);
    const storages = [];
    for (const storageId of storageIds) {
      const rows = await db.select().from(storagesTable).where(eq(storagesTable.id, storageId));
      if (rows.length > 0) {
        storages.push(mapToStorage(rows[0]));
      }
    }
    return storages;
  },
  /**
   * Link a storage to an app
   */
  linkStorage: async (appId, storageId) => {
    const db = getDB();
    const existing = await db.select().from(appStorageTable).where(
      and(
        eq(appStorageTable.appId, appId),
        eq(appStorageTable.storageId, storageId)
      )
    );
    if (existing.length > 0) {
      return;
    }
    await db.insert(appStorageTable).values({ appId, storageId });
  },
  /**
   * Unlink a storage from an app
   */
  unlinkStorage: async (appId, storageId) => {
    const db = getDB();
    await db.delete(appStorageTable).where(
      and(
        eq(appStorageTable.appId, appId),
        eq(appStorageTable.storageId, storageId)
      )
    );
  },
  /**
   * Unlink all storages from an app
   */
  unlinkAllStorages: async (appId) => {
    const db = getDB();
    await db.delete(appStorageTable).where(eq(appStorageTable.appId, appId));
  }
};
const StorageRepo = {
  getAll: async () => {
    const db = getDB();
    const rows = await db.select().from(storagesTable);
    return rows.map(mapToStorage);
  },
  /**
   * Get all storages with their apps eagerly loaded via database join
   */
  getAllWithApps: async () => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "storagesTablePostgres" : "storagesTableSqlite"].findMany({
      with: {
        appStorages: {
          with: {
            app: true
          }
        }
      }
    });
    return rows.map((row) => {
      const storage = mapToStorage(row);
      const apps = (row.appStorages || []).map((as) => mapToApp(as.app));
      return { ...storage, apps };
    });
  },
  findByName: async (name) => {
    const db = getDB();
    const rows = await db.select().from(storagesTable).where(eq(storagesTable.name, name));
    if (rows.length === 0) {
      throw new Error(`Storage "${name}" not found`);
    }
    return mapToStorage(rows[0]);
  },
  add: async (data, createdBy) => {
    const db = getDB();
    const existing = await db.select().from(storagesTable).where(eq(storagesTable.name, data.name));
    if (existing.length > 0) {
      throw new Error(`Storage "${data.name}" already exists`);
    }
    await db.insert(storagesTable).values({
      name: data.name,
      linkName: data.linkName ?? null,
      path: data.path,
      createdBy: createdBy || "system"
    });
    return await StorageRepo.findByName(data.name);
  },
  remove: async (name) => {
    const db = getDB();
    await db.delete(storagesTable).where(eq(storagesTable.name, name));
  },
  /**
   * Unlink all apps from a storage
   */
  unlinkAllApps: async (storageId) => {
    const db = getDB();
    await db.delete(appStorageTable).where(eq(appStorageTable.storageId, storageId));
  },
  /**
   * Find multiple storages by their names in a single query
   */
  findByNames: async (names) => {
    if (names.length === 0) return [];
    const db = getDB();
    const { inArray } = await import("drizzle-orm");
    const rows = await db.select().from(storagesTable).where(inArray(storagesTable.name, names));
    return rows.map(mapToStorage);
  }
};
const DomainRepo = {
  getAll: async () => {
    const db = getDB();
    const rows = await db.select().from(domainsTable);
    return rows.map(mapToDomain);
  },
  /**
   * Get all domains with their routes eagerly loaded
   */
  getAllWithRoutes: async () => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "domainsTablePostgres" : "domainsTableSqlite"].findMany({
      with: {
        routes: {
          with: {
            app: true
          }
        }
      }
    });
    return rows.map((row) => {
      const domain = mapToDomain(row);
      const routes = (row.routes || []).map((r) => {
        const route = mapToRoute(r);
        const app = mapToApp(r.app);
        return { ...route, app };
      });
      return { ...domain, routes };
    });
  },
  findByName: async (name) => {
    const db = getDB();
    const rows = await db.select().from(domainsTable).where(eq(domainsTable.name, name));
    if (rows.length === 0) {
      throw new Error(`Domain "${name}" not found`);
    }
    return mapToDomain(rows[0]);
  },
  /**
   * Find domain by name with routes eagerly loaded
   */
  findByNameWithRoutes: async (name) => {
    const db = getDB();
    const row = await db.query[dbType === "postgres" ? "domainsTablePostgres" : "domainsTableSqlite"].findFirst({
      where: (domains, { eq: eq2 }) => eq2(domains.name, name),
      with: {
        routes: {
          with: {
            app: true
          }
        }
      }
    });
    if (!row) {
      throw new Error(`Domain "${name}" not found`);
    }
    const domain = mapToDomain(row);
    const routes = (row.routes || []).map((r) => {
      const route = mapToRoute(r);
      const app = mapToApp(r.app);
      return { ...route, app };
    });
    return { ...domain, routes };
  },
  add: async (data, createdBy) => {
    const db = getDB();
    const existing = await db.select().from(domainsTable).where(eq(domainsTable.name, data.name));
    if (existing.length > 0) {
      throw new Error(`Domain "${data.name}" already exists`);
    }
    const user = createdBy || "system";
    await db.insert(domainsTable).values({
      name: data.name,
      ssl: serializeJSON({ mode: "none" }),
      headers: null,
      lastPushedAt: null,
      configPath: null,
      lastCompiledAt: null,
      createdBy: user,
      updatedBy: user
    });
    return await DomainRepo.findByName(data.name);
  },
  remove: async (name) => {
    const db = getDB();
    await db.delete(domainsTable).where(eq(domainsTable.name, name));
  },
  update: async function(name, data, updatedBy) {
    const db = getDB();
    const domain = await this.findByName(name);
    const updateFields = {
      ...data
    };
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.updatedAt;
    delete updateFields.createdBy;
    updateFields.updatedBy = updatedBy || "system";
    if (updateFields.ssl) {
      updateFields.ssl = serializeJSON(updateFields.ssl);
    }
    if (updateFields.headers) {
      updateFields.headers = serializeJSON(updateFields.headers);
    }
    await db.update(domainsTable).set(updateFields).where(eq(domainsTable.name, domain.name));
    return await this.findByName(name);
  }
};
const RouteRepo = {
  getAll: async () => {
    const db = getDB();
    const rows = await db.select().from(routesTable);
    return rows.map(mapToRoute);
  },
  /**
   * Get all routes with app details eagerly loaded
   */
  getAllWithApp: async () => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "routesTablePostgres" : "routesTableSqlite"].findMany({
      with: {
        app: true
      }
    });
    return rows.map((row) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      return { ...route, app };
    });
  },
  getAllByDomainId: async (domainId) => {
    const db = getDB();
    const rows = await db.select().from(routesTable).where(eq(routesTable.domainId, domainId));
    return rows.map(mapToRoute);
  },
  getAllByAppId: async (appId) => {
    const db = getDB();
    const rows = await db.select().from(routesTable).where(eq(routesTable.appId, appId));
    return rows.map(mapToRoute);
  },
  /**
   * Get routes with app details populated for a domain
   */
  getAllByDomainIdWithApp: async (domainId) => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "routesTablePostgres" : "routesTableSqlite"].findMany({
      where: (routes, { eq: eq2 }) => eq2(routes.domainId, domainId),
      with: {
        app: true
      }
    });
    return rows.map((row) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      return { ...route, app };
    });
  },
  /**
   * Get routes with app details populated for an app
   */
  getAllByAppIdWithApp: async (appId) => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "routesTablePostgres" : "routesTableSqlite"].findMany({
      where: (routes, { eq: eq2 }) => eq2(routes.appId, appId),
      with: {
        app: true
      }
    });
    return rows.map((row) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      return { ...route, app };
    });
  },
  /**
   * Get routes with both app and domain details populated for an app
   */
  getAllByAppIdWithAppAndDomain: async (appId) => {
    const db = getDB();
    const rows = await db.query[dbType === "postgres" ? "routesTablePostgres" : "routesTableSqlite"].findMany({
      where: (routes, { eq: eq2 }) => eq2(routes.appId, appId),
      with: {
        app: true,
        domain: true
      }
    });
    return rows.map((row) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      const domain = mapToDomain(row.domain);
      return { ...route, app, domain };
    });
  },
  findByDomainAndPath: async (domainId, path) => {
    const db = getDB();
    const rows = await db.select().from(routesTable).where(
      and(eq(routesTable.domainId, domainId), eq(routesTable.path, path))
    );
    if (rows.length === 0) return void 0;
    return mapToRoute(rows[0]);
  },
  add: async (data, createdBy) => {
    const db = getDB();
    const user = createdBy || "system";
    const result = await db.insert(routesTable).values({
      domainId: data.domainId,
      path: data.path,
      appId: data.appId,
      headers: null,
      createdBy: user,
      updatedBy: user
    }).returning();
    if (result && result.length > 0) {
      return mapToRoute(result[0]);
    }
    const route = await RouteRepo.findByDomainAndPath(data.domainId, data.path);
    if (!route) {
      throw new Error("Failed to retrieve newly created route");
    }
    return route;
  },
  remove: async (id) => {
    const db = getDB();
    await db.delete(routesTable).where(eq(routesTable.id, id));
  },
  removeByDomainId: async (domainId) => {
    const db = getDB();
    await db.delete(routesTable).where(eq(routesTable.domainId, domainId));
  },
  update: async (id, data, updatedBy) => {
    const db = getDB();
    const updateFields = {
      ...data
    };
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.updatedAt;
    delete updateFields.createdBy;
    updateFields.updatedBy = updatedBy || "system";
    if (updateFields.headers) {
      updateFields.headers = serializeJSON(updateFields.headers);
    }
    await db.update(routesTable).set(updateFields).where(eq(routesTable.id, id));
    const rows = await db.select().from(routesTable).where(eq(routesTable.id, id));
    if (rows.length === 0) {
      throw new Error("Route not found after update");
    }
    return mapToRoute(rows[0]);
  }
};
function mapToAppConfig(row) {
  return {
    id: row.id,
    appId: row.appId,
    instances: row.instances,
    maxMemory: row.maxMemory,
    autorestart: row.autorestart === null || row.autorestart === void 0 ? null : typeof row.autorestart === "string" ? row.autorestart === "true" : Boolean(row.autorestart),
    maxRestarts: row.maxRestarts ?? null,
    minUptime: row.minUptime ?? null,
    restartDelay: row.restartDelay ?? null,
    nodeArgs: row.nodeArgs ?? null,
    killTimeout: row.killTimeout ?? null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    createdBy: row.createdBy || "system",
    updatedBy: row.updatedBy || "system"
  };
}
const AppConfigRepo = {
  findByAppId: async (appId) => {
    const db = getDB();
    const rows = await db.select().from(appConfigTable).where(eq(appConfigTable.appId, appId));
    if (rows.length === 0) return void 0;
    return mapToAppConfig(rows[0]);
  },
  create: async (data, createdBy) => {
    const db = getDB();
    const user = createdBy || "system";
    const insertData = {
      appId: data.appId,
      instances: data.instances ?? 1,
      maxMemory: data.maxMemory ?? "250M",
      autorestart: data.autorestart === null || data.autorestart === void 0 ? null : dbType === "sqlite" ? data.autorestart ? 1 : 0 : String(data.autorestart),
      maxRestarts: data.maxRestarts ?? null,
      minUptime: data.minUptime ?? null,
      restartDelay: data.restartDelay ?? null,
      nodeArgs: data.nodeArgs ?? null,
      killTimeout: data.killTimeout ?? null,
      createdBy: user,
      updatedBy: user
    };
    await db.insert(appConfigTable).values(insertData);
    const config = await AppConfigRepo.findByAppId(data.appId);
    if (!config) throw new Error("Failed to create app config");
    return config;
  },
  update: async (appId, data, updatedBy) => {
    const db = getDB();
    const updateFields = {};
    if (data.instances !== void 0) updateFields.instances = data.instances;
    if (data.maxMemory !== void 0) updateFields.maxMemory = data.maxMemory;
    if ("autorestart" in data) {
      updateFields.autorestart = data.autorestart === null || data.autorestart === void 0 ? null : dbType === "sqlite" ? data.autorestart ? 1 : 0 : String(data.autorestart);
    }
    if ("maxRestarts" in data) updateFields.maxRestarts = data.maxRestarts ?? null;
    if ("minUptime" in data) updateFields.minUptime = data.minUptime ?? null;
    if ("restartDelay" in data) updateFields.restartDelay = data.restartDelay ?? null;
    if ("nodeArgs" in data) updateFields.nodeArgs = data.nodeArgs ?? null;
    if ("killTimeout" in data) updateFields.killTimeout = data.killTimeout ?? null;
    updateFields.updatedBy = updatedBy || "system";
    await db.update(appConfigTable).set(updateFields).where(eq(appConfigTable.appId, appId));
    const config = await AppConfigRepo.findByAppId(appId);
    if (!config) throw new Error("App config not found after update");
    return config;
  },
  delete: async (appId) => {
    const db = getDB();
    await db.delete(appConfigTable).where(eq(appConfigTable.appId, appId));
  }
};
export {
  AppConfigRepo,
  AppRepo,
  DomainRepo,
  RouteRepo,
  StorageRepo
};
