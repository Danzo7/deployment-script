import { getDB } from './db.js';
import { App, Domain, Route, Storage } from './model.js';
import { randomUUID } from 'crypto';
import { toISO } from '../utils/date-helper.js';

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
      createdAt: toISO(),
      updatedAt: toISO(),
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
    Object.assign(app, updatedData, { updatedAt: toISO() });
    db.write();
    return app;
  },

  addBuild: function (name: string, buildPath: string) {
    const db = getDB();
    const app = this.findByName(name);
    app.lastDeploy = toISO();
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
  updateDeployedCommit: function (
    name: string,
    commit: { hash: string; message: string; author: string; date: string }
  ) {
    const db = getDB();
    const app = this.findByName(name);
    app.lastDeployedCommit = commit;
    db.write();
    return app;
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
      createdAt: toISO(),
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

export const DomainRepo = {
  getAll: (): Domain[] => {
    const db = getDB();
    return db.data.domains;
  },

  findByName: (name: string): Domain => {
    const db = getDB();
    const domain = db.data.domains.find((d: Domain) => d.name === name);
    if (!domain) {
      throw new Error(`Domain "${name}" not found`);
    }
    return domain;
  },

  add: (data: { name: string }): Domain => {
    const db = getDB();
    if (db.data.domains.find((d: Domain) => d.name === data.name)) {
      throw new Error(`Domain "${data.name}" already exists`);
    }
    const domain: Domain = {
      id: randomUUID(),
      name: data.name,
      createdAt: toISO(),
      updatedAt: toISO(),
      ssl: { mode: 'none' },
    };
    db.data.domains.push(domain);
    db.write();
    return domain;
  },

  remove: (name: string): void => {
    const db = getDB();
    db.data.domains = db.data.domains.filter((d: Domain) => d.name !== name);
    db.write();
  },

  update: function (name: string, data: Partial<Domain>): Domain {
    const db = getDB();
    const domain = this.findByName(name);
    Object.assign(domain, data, { updatedAt: toISO() });
    db.write();
    return domain;
  },
};

export const RouteRepo = {
  getAll: (): Route[] => {
    const db = getDB();
    return db.data.routes;
  },

  findByDomainAndPath: (domainId: string, path: string): Route | undefined => {
    const db = getDB();
    return db.data.routes.find((r: Route) => r.domainId === domainId && r.path === path);
  },

  add: (data: { domainId: string; path: string; appName: string }): Route => {
    const db = getDB();
    const route: Route = {
      id: randomUUID(),
      domainId: data.domainId,
      path: data.path,
      appName: data.appName,
      createdAt: toISO(),
      updatedAt: toISO(),
    };
    db.data.routes.push(route);
    db.write();
    return route;
  },

  remove: (id: string): void => {
    const db = getDB();
    db.data.routes = db.data.routes.filter((r: Route) => r.id !== id);
    db.write();
  },

  removeByDomainId: (domainId: string): void => {
    const db = getDB();
    db.data.routes = db.data.routes.filter((r: Route) => r.domainId !== domainId);
    db.write();
  },
};
