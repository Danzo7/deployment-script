import { getDB } from './db.js';
import { App, Storage } from './model.js';
import { randomUUID } from 'crypto';

export const AppRepo = {
  getAll: () => {
    const db = getDB();
    return db.data.apps;
  },
  findByName: (name: string) => {
    const db = getDB();
    const app = db.data!.apps.find((app: App) => app.name === name);
    if (!app) {
      throw new Error('App not found');
    }
    return app;
  },
  add: (data: Omit<App, 'id' | 'createdAt' | 'updatedAt' | 'lastDeploy'>) => {
    const db = getDB();
    if (db.data.apps.find((_app: App) => _app.name === data.name)) {
      throw new Error('An app with the same name already exists');
    }
    const samePort = db.data.apps.find((_app: App) => _app.port === data.port);
    if (samePort) {
      throw new Error(
        `The port ${data.port} is already in use by ${samePort.name}`
      );
    }
    const app = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      id: randomUUID(),
      ...data,
    };
    db.data.apps.push(app);
    db.write();
    return app;
  },
  remove: function (name: string) {
    const db = getDB();
    const app = this.findByName(name);
    db.data.apps = db.data.apps.filter((_app: App) => _app.name !== app.name);
    db.write();
    return true;
  },
  update: function (name: string, updatedData: Partial<App>) {
    const db = getDB();
    const app = this.findByName(name);
    Object.assign(app, updatedData, { updatedAt: new Date().toISOString() });
    db.write();
    return app;
  },

  addBuild: function (name: string, buildPath: string) {
    const db = getDB();
    const app = this.findByName(name);
    app.lastDeploy = new Date().toISOString();
    if (!app.builds) app.builds = [];
    app.builds.push(buildPath);
    app.activeBuild = buildPath;
    db.write();
    return app;
  },
  /**
   * Resolves activeBuild to a path string, handling legacy numeric-index values
   * stored by older versions of the tool.
   */
  resolveActiveBuild: function (name: string): string | undefined {
    const app = this.findByName(name);
    if (!app.builds?.length) return undefined;
    const raw = app.activeBuild as unknown;
    if (typeof raw === 'number') {
      // backward-compat: migrate the stored index to a path
      const resolved = app.builds[raw] ?? app.builds[app.builds.length - 1];
      app.activeBuild = resolved;
      getDB().write();
      return resolved;
    }
    return typeof raw === 'string' ? raw : app.builds[app.builds.length - 1];
  },
  removeBuild: function (name: string, buildPath: string) {
    const db = getDB();
    const app = this.findByName(name);
    if (!app.builds) app.builds = [];
    app.builds = app.builds.filter((build) => build !== buildPath);
    db.write();
    return app;
  },
};

export const StorageRepo = {
  getAll: (): Storage[] => {
    const db = getDB();
    return db.data.storages;
  },

  findByName: (name: string): Storage => {
    const db = getDB();
    const storage = db.data.storages.find((s: Storage) => s.name === name);
    if (!storage) {
      throw new Error(`Storage "${name}" not found`);
    }
    return storage;
  },

  add: (data: { name: string; linkName: string; path: string }): Storage => {
    const db = getDB();
    if (db.data.storages.find((s: Storage) => s.name === data.name)) {
      throw new Error(`Storage "${data.name}" already exists`);
    }
    if (db.data.storages.find((s: Storage) => s.linkName === data.linkName)) {
      throw new Error(`A storage with link name "${data.linkName}" already exists`);
    }
    const storage: Storage = {
      id: randomUUID(),
      name: data.name,
      linkName: data.linkName,
      path: data.path,
      createdAt: new Date().toISOString(),
    };
    db.data.storages.push(storage);
    db.write();
    return storage;
  },

  remove: (name: string): void => {
    const db = getDB();
    db.data.storages = db.data.storages.filter((s: Storage) => s.name !== name);
    db.write();
  },
};
