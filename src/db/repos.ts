import { getDB } from './db.js';
import { App, Domain, Route, Storage, DomainSsl, RouteWithApp, DomainWithRoutesAndApps, RouteWithAppAndDomain, AppWithStorages, StorageWithApps } from './model.js';
import { eq, and } from 'drizzle-orm';
import { appsTable, storagesTable, domainsTable, routesTable, appStorageTable, dbType } from './schema.js';

// Helper to serialize JSON for SQLite
function serializeJSON(data: any): string | any {
  if (dbType === 'sqlite') {
    return JSON.stringify(data);
  }
  return data; // PostgreSQL handles JSON natively
}

// Helper to deserialize JSON from SQLite
function deserializeJSON<T>(data: string | any): T | undefined {
  if (!data) return undefined;
  if (dbType === 'sqlite' && typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return data as T;
}

// Helper to convert timestamp to Date
function toDate(timestamp: any): Date | undefined {
  if (!timestamp) return undefined;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === 'number') return new Date(timestamp * 1000); // SQLite unix timestamp
  return new Date(timestamp); // ISO string
}

// Helper to map DB row to App model
function mapToApp(row: any): App {
  return {
    id: row.id,
    name: row.name,
    appDir: row.appDir,
    createdAt: toDate(row.createdAt)!,
    updatedAt: toDate(row.updatedAt)!,
    port: row.port,
    instances: row.instances,
    repo: row.repo,
    branch: row.branch,
    vcsType: row.vcsType as 'git' | 'svn',
    lastDeploy: toDate(row.lastDeploy),
    builds: deserializeJSON<string[]>(row.builds) || [],
    activeBuild: row.activeBuild,
    projectType: row.projectType as 'nextjs' | 'nestjs' | 'dotnet',
    projectDir: row.projectDir,
    lastDeployedCommit: deserializeJSON<App['lastDeployedCommit']>(row.lastDeployedCommit),
  };
}

// Helper to map DB row to Storage model
function mapToStorage(row: any): Storage {
  return {
    id: row.id,
    name: row.name,
    linkName: row.linkName ?? null,
    path: row.path,
    createdAt: toDate(row.createdAt)!,
  };
}

// Helper to map DB row to Domain model
function mapToDomain(row: any): Domain {
  return {
    id: row.id,
    name: row.name,
    createdAt: toDate(row.createdAt)!,
    updatedAt: toDate(row.updatedAt)!,
    ssl: deserializeJSON<DomainSsl>(row.ssl) || { mode: 'none' },
    headers: deserializeJSON<Record<string, string>>(row.headers),
    lastPushedAt: toDate(row.lastPushedAt),
    configPath: row.configPath,
    lastCompiledAt: toDate(row.lastCompiledAt),
  };
}

// Helper to map DB row to Route model
function mapToRoute(row: any): Route {
  return {
    id: row.id,
    domainId: row.domainId,
    path: row.path,
    appId: row.appId,
    createdAt: toDate(row.createdAt)!,
    updatedAt: toDate(row.updatedAt)!,
    headers: deserializeJSON<Record<string, string>>(row.headers),
  };
}

// NOTE: toDbFields is no longer needed since we use camelCase everywhere
// Drizzle will handle the mapping automatically

export const AppRepo = {
  getAll: async (): Promise<App[]> => {
    const db: any = getDB();
    const rows = await db.select().from(appsTable);
    return rows.map(mapToApp);
  },

  /**
   * Get all apps with their storages eagerly loaded via database join
   */
  getAllWithStorages: async (): Promise<AppWithStorages[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'appsTablePostgres' : 'appsTableSqlite'].findMany({
      with: {
        appStorages: {
          with: {
            storage: true,
          },
        },
      },
    });
    
    return rows.map((row: any) => {
      const app = mapToApp(row);
      const storages = (row.appStorages || []).map((as: any) => mapToStorage(as.storage));
      return { ...app, storages };
    });
  },

  findById: async (id: string | number): Promise<App> => {
    const db: any = getDB();
    const rows = await db.select().from(appsTable).where(eq(appsTable.id, id));
    if (rows.length === 0) {
      throw new Error('App not found');
    }
    return mapToApp(rows[0]);
  },

  findByName: async (name: string): Promise<App> => {
    const db: any = getDB();
    const rows = await db.select().from(appsTable).where(eq(appsTable.name, name));
    if (rows.length === 0) {
      throw new Error('App not found');
    }
    return mapToApp(rows[0]);
  },

  /**
   * Find app by name with storages eagerly loaded via database join
   */
  findByNameWithStorages: async (name: string): Promise<AppWithStorages> => {
    const db: any = getDB();
    const row = await db.query[dbType === 'postgres' ? 'appsTablePostgres' : 'appsTableSqlite'].findFirst({
      where: (apps: any, { eq }: any) => eq(apps.name, name),
      with: {
        appStorages: {
          with: {
            storage: true,
          },
        },
      },
    });
    
    if (!row) {
      throw new Error('App not found');
    }
    
    const app = mapToApp(row);
    const storages = (row.appStorages || []).map((as: any) => mapToStorage(as.storage));
    return { ...app, storages };
  },

  add: async (data: Omit<App, 'id' | 'createdAt' | 'updatedAt' | 'lastDeploy'>): Promise<App> => {
    const db: any = getDB();
    
    // Check if app with same name exists
    const existing = await db.select().from(appsTable).where(eq(appsTable.name, data.name));
    if (existing.length > 0) {
      throw new Error('An app with the same name already exists');
    }

    // Check if port is already in use
    const samePort = await db.select().from(appsTable).where(eq(appsTable.port, data.port));
    if (samePort.length > 0) {
      const portApp = mapToApp(samePort[0]);
      throw new Error(`The port ${data.port} is already in use by ${portApp.name}`);
    }

    const insertData = {
      name: data.name,
      appDir: data.appDir,
      port: data.port,
      instances: data.instances ?? 1,
      repo: data.repo,
      branch: data.branch,
      vcsType: data.vcsType ?? 'git',
      builds: serializeJSON(data.builds || []),
      activeBuild: data.activeBuild,
      projectType: data.projectType,
      projectDir: data.projectDir,
      lastDeployedCommit: serializeJSON(data.lastDeployedCommit),
    };

    await db.insert(appsTable).values(insertData);
    
    // Fetch the newly inserted app to get the DB-generated id and timestamps
    return await AppRepo.findByName(data.name);
  },

  remove: async function (name: string): Promise<boolean> {
    const db: any = getDB();
    const app = await this.findByName(name);
    await db.delete(appsTable).where(eq(appsTable.name, app.name));
    return true;
  },

  update: async function (name: string, updatedData: Partial<App>): Promise<App> {
    const db: any = getDB();
    const app = await this.findByName(name);
    
    const updateFields: any = {
      ...updatedData,
    };

    // Remove fields that should not be updated manually
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.updatedAt; // DB will handle this automatically

    // Serialize JSON fields
    if (updateFields.builds) {
      updateFields.builds = serializeJSON(updateFields.builds);
    }
    if (updateFields.lastDeployedCommit) {
      updateFields.lastDeployedCommit = serializeJSON(updateFields.lastDeployedCommit);
    }

    await db.update(appsTable).set(updateFields).where(eq(appsTable.name, app.name));
    
    return await this.findByName(name);
  },

  addBuild: async function (name: string, buildPath: string): Promise<App> {
    const app = await this.findByName(name);
    const builds = app.builds || [];
    builds.push(buildPath);
    
    return await this.update(name, {
      lastDeploy: new Date(),
      builds,
      activeBuild: buildPath,
    });
  },

  resolveActiveBuild: async function (name: string): Promise<string | undefined> {
    const app = await this.findByName(name);
    if (!app.builds?.length) return undefined;
    
    const raw = app.activeBuild as unknown;
    if (typeof raw === 'number') {
      // backward-compat: migrate the stored index to a path
      const resolved = app.builds[raw] ?? app.builds[app.builds.length - 1];
      await this.update(name, { activeBuild: resolved });
      return resolved;
    }
    return typeof raw === 'string' ? raw : app.builds[app.builds.length - 1];
  },

  updateDeployedCommit: async function (
    name: string,
    commit: { hash: string; message: string; author: string; date: string }
  ): Promise<App> {
    return await this.update(name, {
      lastDeployedCommit: commit,
    });
  },

  removeBuild: async function (name: string, buildPath: string): Promise<App> {
    const app = await this.findByName(name);
    const builds = (app.builds || []).filter((build) => build !== buildPath);
    return await this.update(name, { builds });
  },

  /**
   * Find apps by storage using the AppStorage junction table
   */
  findByStorageId: async (storageId: string | number): Promise<App[]> => {
    const db: any = getDB();
    const appStorages = await db.select().from(appStorageTable).where(eq(appStorageTable.storageId, storageId));
    
    const apps: App[] = [];
    for (const appStorage of appStorages) {
      try {
        const app = await AppRepo.findById(appStorage.appId);
        apps.push(app);
      } catch {
        // Skip if app no longer exists
      }
    }
    
    return apps;
  },

  /**
   * Get all storages linked to an app
   */
  getStoragesByAppId: async (appId: string | number): Promise<Storage[]> => {
    const db: any = getDB();
    const appStorages = await db.select().from(appStorageTable).where(eq(appStorageTable.appId, appId));
    
    if (appStorages.length === 0) return [];
    
    const storageIds = appStorages.map((as: any) => as.storageId);
    const storages: Storage[] = [];
    
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
  linkStorage: async (appId: string | number, storageId: string | number): Promise<void> => {
    const db: any = getDB();
    
    // Check if link already exists
    const existing = await db
      .select()
      .from(appStorageTable)
      .where(and(eq(appStorageTable.appId, appId), eq(appStorageTable.storageId, storageId)));
    
    if (existing.length > 0) {
      return; // Already linked
    }

    await db.insert(appStorageTable).values({ appId, storageId });
  },

  /**
   * Unlink a storage from an app
   */
  unlinkStorage: async (appId: string | number, storageId: string | number): Promise<void> => {
    const db: any = getDB();
    await db
      .delete(appStorageTable)
      .where(and(eq(appStorageTable.appId, appId), eq(appStorageTable.storageId, storageId)));
  },

  /**
   * Unlink all storages from an app
   */
  unlinkAllStorages: async (appId: string | number): Promise<void> => {
    const db: any = getDB();
    await db.delete(appStorageTable).where(eq(appStorageTable.appId, appId));
  },
};

export const StorageRepo = {
  getAll: async (): Promise<Storage[]> => {
    const db: any = getDB();
    const rows = await db.select().from(storagesTable);
    return rows.map(mapToStorage);
  },

  /**
   * Get all storages with their apps eagerly loaded via database join
   */
  getAllWithApps: async (): Promise<StorageWithApps[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'storagesTablePostgres' : 'storagesTableSqlite'].findMany({
      with: {
        appStorages: {
          with: {
            app: true,
          },
        },
      },
    });
    
    return rows.map((row: any) => {
      const storage = mapToStorage(row);
      const apps = (row.appStorages || []).map((as: any) => mapToApp(as.app));
      return { ...storage, apps };
    });
  },

  findByName: async (name: string): Promise<Storage> => {
    const db: any = getDB();
    const rows = await db.select().from(storagesTable).where(eq(storagesTable.name, name));
    if (rows.length === 0) {
      throw new Error(`Storage "${name}" not found`);
    }
    return mapToStorage(rows[0]);
  },

  add: async (data: { name: string; linkName: string|null; path: string }): Promise<Storage> => {
    const db: any = getDB();
    
    // Check if storage exists
    const existing = await db.select().from(storagesTable).where(eq(storagesTable.name, data.name));
    if (existing.length > 0) {
      throw new Error(`Storage "${data.name}" already exists`);
    }

    await db.insert(storagesTable).values({
      name: data.name,
      linkName: data.linkName ?? null,
      path: data.path,
    });
    
    // Fetch the newly inserted storage to get the DB-generated id and timestamps
    return await StorageRepo.findByName(data.name);
  },

  remove: async (name: string): Promise<void> => {
    const db: any = getDB();
    await db.delete(storagesTable).where(eq(storagesTable.name, name));
  },

  /**
   * Unlink all apps from a storage
   */
  unlinkAllApps: async (storageId: string | number): Promise<void> => {
    const db: any = getDB();
    await db.delete(appStorageTable).where(eq(appStorageTable.storageId, storageId));
  },

  /**
   * Find multiple storages by their names in a single query
   */
  findByNames: async (names: string[]): Promise<Storage[]> => {
    if (names.length === 0) return [];
    
    const db: any = getDB();
    
    // Use inArray for efficient batch lookup
    const { inArray } = await import('drizzle-orm');
    const rows = await db.select().from(storagesTable).where(inArray(storagesTable.name, names));
    
    return rows.map(mapToStorage);
  },
};

export const DomainRepo = {
  getAll: async (): Promise<Domain[]> => {
    const db: any = getDB();
    const rows = await db.select().from(domainsTable);
    return rows.map(mapToDomain);
  },

  /**
   * Get all domains with their routes eagerly loaded
   */
  getAllWithRoutes: async (): Promise<DomainWithRoutesAndApps[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'domainsTablePostgres' : 'domainsTableSqlite'].findMany({
      with: {
        routes: {
          with: {
            app: true,
          },
        },
      },
    });
    
    return rows.map((row: any) => {
      const domain = mapToDomain(row);
      const routes = (row.routes || []).map((r: any) => {
        const route = mapToRoute(r);
        const app = mapToApp(r.app);
        return { ...route, app };
      });
      
      return { ...domain, routes };
    });
  },

  findByName: async (name: string): Promise<Domain> => {
    const db: any = getDB();
    const rows = await db.select().from(domainsTable).where(eq(domainsTable.name, name));
    if (rows.length === 0) {
      throw new Error(`Domain "${name}" not found`);
    }
    return mapToDomain(rows[0]);
  },

  /**
   * Find domain by name with routes eagerly loaded
   */
  findByNameWithRoutes: async (name: string): Promise<DomainWithRoutesAndApps> => {
    const db: any = getDB();
    const row = await db.query[dbType === 'postgres' ? 'domainsTablePostgres' : 'domainsTableSqlite'].findFirst({
      where: (domains: any, { eq }: any) => eq(domains.name, name),
      with: {
        routes: {
          with: {
            app: true,
          },
        },
      },
    });
    
    if (!row) {
      throw new Error(`Domain "${name}" not found`);
    }
    
    const domain = mapToDomain(row);
    const routes = (row.routes || []).map((r: any) => {
      const route = mapToRoute(r);
      const app = mapToApp(r.app);
      return { ...route, app };
    });
    
    return { ...domain, routes };
  },

  add: async (data: { name: string }): Promise<Domain> => {
    const db: any = getDB();
    
    const existing = await db.select().from(domainsTable).where(eq(domainsTable.name, data.name));
    if (existing.length > 0) {
      throw new Error(`Domain "${data.name}" already exists`);
    }

    await db.insert(domainsTable).values({
      name: data.name,
      ssl: serializeJSON({ mode: 'none' }),
      headers: null,
      lastPushedAt: null,
      configPath: null,
      lastCompiledAt: null,
    });
    
    // Fetch the newly inserted domain to get the DB-generated id and timestamps
    return await DomainRepo.findByName(data.name);
  },

  remove: async (name: string): Promise<void> => {
    const db: any = getDB();
    await db.delete(domainsTable).where(eq(domainsTable.name, name));
  },

  update: async function (name: string, data: Partial<Domain>): Promise<Domain> {
    const db: any = getDB();
    const domain = await this.findByName(name);
    
    const updateFields: any = {
      ...data,
    };

    // Remove fields that should not be updated manually
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.updatedAt; // DB will handle this automatically

    // Serialize JSON fields
    if (updateFields.ssl) {
      updateFields.ssl = serializeJSON(updateFields.ssl);
    }
    if (updateFields.headers) {
      updateFields.headers = serializeJSON(updateFields.headers);
    }

    await db.update(domainsTable).set(updateFields).where(eq(domainsTable.name, domain.name));
    return await this.findByName(name);
  },
};

export const RouteRepo = {
  getAll: async (): Promise<Route[]> => {
    const db: any = getDB();
    const rows = await db.select().from(routesTable);
    return rows.map(mapToRoute);
  },

  /**
   * Get all routes with app details eagerly loaded
   */
  getAllWithApp: async (): Promise<RouteWithApp[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'routesTablePostgres' : 'routesTableSqlite'].findMany({
      with: {
        app: true,
      },
    });
    
    return rows.map((row: any) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      return { ...route, app };
    });
  },

  getAllByDomainId: async (domainId: string | number): Promise<Route[]> => {
    const db: any = getDB();
    const rows = await db.select().from(routesTable).where(eq(routesTable.domainId, domainId));
    return rows.map(mapToRoute);
  },

  getAllByAppId: async (appId: string | number): Promise<Route[]> => {
    const db: any = getDB();
    const rows = await db.select().from(routesTable).where(eq(routesTable.appId, appId));
    return rows.map(mapToRoute);
  },

  /**
   * Get routes with app details populated for a domain
   */
  getAllByDomainIdWithApp: async (domainId: string | number): Promise<RouteWithApp[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'routesTablePostgres' : 'routesTableSqlite'].findMany({
      where: (routes: any, { eq }: any) => eq(routes.domainId, domainId),
      with: {
        app: true,
      },
    });
    
    return rows.map((row: any) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      return { ...route, app };
    });
  },

  /**
   * Get routes with app details populated for an app
   */
  getAllByAppIdWithApp: async (appId: string | number): Promise<RouteWithApp[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'routesTablePostgres' : 'routesTableSqlite'].findMany({
      where: (routes: any, { eq }: any) => eq(routes.appId, appId),
      with: {
        app: true,
      },
    });
    
    return rows.map((row: any) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      return { ...route, app };
    });
  },

  /**
   * Get routes with both app and domain details populated for an app
   */
  getAllByAppIdWithAppAndDomain: async (appId: string | number): Promise<RouteWithAppAndDomain[]> => {
    const db: any = getDB();
    const rows = await db.query[dbType === 'postgres' ? 'routesTablePostgres' : 'routesTableSqlite'].findMany({
      where: (routes: any, { eq }: any) => eq(routes.appId, appId),
      with: {
        app: true,
        domain: true,
      },
    });
    
    return rows.map((row: any) => {
      const route = mapToRoute(row);
      const app = mapToApp(row.app);
      const domain = mapToDomain(row.domain);
      return { ...route, app, domain };
    });
  },

  findByDomainAndPath: async (domainId: string | number, path: string): Promise<Route | undefined> => {
    const db: any = getDB();
    const rows = await db
      .select()
      .from(routesTable)
      .where(and(eq(routesTable.domainId, domainId), eq(routesTable.path, path)));
    
    if (rows.length === 0) return undefined;
    return mapToRoute(rows[0]);
  },

  add: async (data: { domainId: string | number; path: string; appId: string | number }): Promise<Route> => {
    const db: any = getDB();

    const result = await db.insert(routesTable).values({
      domainId: data.domainId,
      path: data.path,
      appId: data.appId,
      headers: null,
    }).returning();
    
    // For SQLite, fetch the newly inserted route since returning() may not work
    if (result && result.length > 0) {
      return mapToRoute(result[0]);
    }
    
    // Fallback: find by domain and path
    const route = await RouteRepo.findByDomainAndPath(data.domainId, data.path);
    if (!route) {
      throw new Error('Failed to retrieve newly created route');
    }
    return route;
  },

  remove: async (id: string | number): Promise<void> => {
    const db: any = getDB();
    await db.delete(routesTable).where(eq(routesTable.id, id));
  },

  removeByDomainId: async (domainId: string | number): Promise<void> => {
    const db: any = getDB();
    await db.delete(routesTable).where(eq(routesTable.domainId, domainId));
  },

  update: async (id: string | number, data: Partial<Route>): Promise<Route> => {
    const db: any = getDB();
    
    const updateFields: any = {
      ...data,
    };

    // Remove fields that should not be updated manually
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.updatedAt; // DB will handle this automatically

    // Serialize JSON fields
    if (updateFields.headers) {
      updateFields.headers = serializeJSON(updateFields.headers);
    }

    await db.update(routesTable).set(updateFields).where(eq(routesTable.id, id));
    
    // Return updated route
    const rows = await db.select().from(routesTable).where(eq(routesTable.id, id));
    if (rows.length === 0) {
      throw new Error('Route not found after update');
    }
    return mapToRoute(rows[0]);
  },
};
