import { getDB } from './db.js';
import { App } from './model.js';
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
  updateLastDeploy: function (name: string) {
    const db = getDB();
    const app = this.findByName(name);
    app.lastDeploy = new Date().toISOString();
    db.write();
    return app;
  },
};
