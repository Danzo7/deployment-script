import {
  sqliteTable,
  text,
  integer,
  index as sqliteIndex,
} from 'drizzle-orm/sqlite-core';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer as pgInteger,
  text as pgText,
  jsonb,
  index as pgIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { DATABASE_TYPE } from '../constants.js';

// Determine if we're using SQLite or PostgreSQL based on environment
export const dbType = DATABASE_TYPE;

// ============================================================================
// SQLite Schema
// ============================================================================

export const appsTableSqlite = sqliteTable(
  'apps',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    appDir: text('appDir').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
    port: integer('port').notNull(),
    instances: integer('instances').default(1),
    repo: text('repo').notNull(),
    branch: text('branch').notNull(),
    vcsType: text('vcsType', { enum: ['git', 'svn', 'local'] }).default('git'),
    lastDeploy: integer('lastDeploy', { mode: 'timestamp' }),
    builds: text('builds'), // JSON array
    activeBuild: text('activeBuild'),
    projectType: text('projectType', {
      enum: ['nextjs', 'nestjs', 'dotnet', 'static'],
    }).notNull(),
    projectDir: text('projectDir'),
    lastDeployedCommit: text('lastDeployedCommit'), // JSON object
  },
  (table) => [
    sqliteIndex('apps_name_idx').on(table.name),
    sqliteIndex('apps_port_idx').on(table.port),
  ]
);

export const storagesTableSqlite = sqliteTable(
  'storages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    linkName: text('linkName'),
    path: text('path').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [sqliteIndex('storages_name_idx').on(table.name)]
);

export const domainsTableSqlite = sqliteTable(
  'domains',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
    ssl: text('ssl').notNull(), // JSON object
    headers: text('headers'), // JSON object
    lastPushedAt: integer('lastPushedAt', { mode: 'timestamp' }),
    configPath: text('configPath'),
    lastCompiledAt: integer('lastCompiledAt', { mode: 'timestamp' }),
  },
  (table) => [sqliteIndex('domains_name_idx').on(table.name)]
);

export const routesTableSqlite = sqliteTable(
  'routes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domainId: integer('domainId')
      .notNull()
      .references(() => domainsTableSqlite.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    appId: integer('appId')
      .notNull()
      .references(() => appsTableSqlite.id, { onDelete: 'cascade' }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
    headers: text('headers'), // JSON object
  },
  (table) => [
    sqliteIndex('routes_domain_id_idx').on(table.domainId),
    sqliteIndex('routes_domain_path_idx').on(table.domainId, table.path),
    sqliteIndex('routes_app_id_idx').on(table.appId),
  ]
);

export const appStorageTableSqlite = sqliteTable(
  'app_storage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    appId: integer('appId')
      .notNull()
      .references(() => appsTableSqlite.id, { onDelete: 'cascade' }),
    storageId: integer('storageId')
      .notNull()
      .references(() => storagesTableSqlite.id, { onDelete: 'cascade' }),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    sqliteIndex('app_storage_app_id_idx').on(table.appId),
    sqliteIndex('app_storage_storage_id_idx').on(table.storageId),
  ]
);

// ============================================================================
// PostgreSQL Schema
// ============================================================================

export const appsTablePostgres = pgTable(
  'apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    appDir: varchar('app_dir', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    port: pgInteger('port').notNull(),
    instances: pgInteger('instances').default(1),
    repo: pgText('repo').notNull(),
    branch: varchar('branch', { length: 255 }).notNull(),
    vcsType: varchar('vcs_type', {
      length: 10,
      enum: ['git', 'svn', 'local'],
    }).default('git'),
    lastDeploy: timestamp('last_deploy', { mode: 'date' }),
    builds: jsonb('builds'), // JSON array
    activeBuild: varchar('active_build', { length: 500 }),
    projectType: varchar('project_type', {
      length: 20,
      enum: ['nextjs', 'nestjs', 'dotnet', 'static'],
    }).notNull(),
    projectDir: varchar('project_dir', { length: 255 }),
    lastDeployedCommit: jsonb('last_deployed_commit'), // JSON object
  },
  (table) => [
    pgIndex('apps_name_idx').on(table.name),
    pgIndex('apps_port_idx').on(table.port),
  ]
);

export const storagesTablePostgres = pgTable(
  'storages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    linkName: varchar('link_name', { length: 255 }),
    path: varchar('path', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [pgIndex('storages_name_idx').on(table.name)]
);

export const domainsTablePostgres = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ssl: jsonb('ssl').notNull(), // JSON object
    headers: jsonb('headers'), // JSON object
    lastPushedAt: timestamp('last_pushed_at', { mode: 'date' }),
    configPath: varchar('config_path', { length: 500 }),
    lastCompiledAt: timestamp('last_compiled_at', { mode: 'date' }),
  },
  (table) => [pgIndex('domains_name_idx').on(table.name)]
);

export const routesTablePostgres = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domainsTablePostgres.id, { onDelete: 'cascade' }),
    path: varchar('path', { length: 500 }).notNull(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appsTablePostgres.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    headers: jsonb('headers'), // JSON object
  },
  (table) => [
    pgIndex('routes_domain_id_idx').on(table.domainId),
    pgIndex('routes_domain_path_idx').on(table.domainId, table.path),
    pgIndex('routes_app_id_idx').on(table.appId),
  ]
);

export const appStorageTablePostgres = pgTable(
  'app_storage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => appsTablePostgres.id, { onDelete: 'cascade' }),
    storageId: uuid('storage_id')
      .notNull()
      .references(() => storagesTablePostgres.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    pgIndex('app_storage_app_id_idx').on(table.appId),
    pgIndex('app_storage_storage_id_idx').on(table.storageId),
  ]
);

// Export the appropriate tables based on dbType
export const appsTable =
  dbType === 'postgres' ? appsTablePostgres : appsTableSqlite;
export const storagesTable =
  dbType === 'postgres' ? storagesTablePostgres : storagesTableSqlite;
export const domainsTable =
  dbType === 'postgres' ? domainsTablePostgres : domainsTableSqlite;
export const routesTable =
  dbType === 'postgres' ? routesTablePostgres : routesTableSqlite;
export const appStorageTable =
  dbType === 'postgres' ? appStorageTablePostgres : appStorageTableSqlite;

// ============================================================================
// Relations
// ============================================================================

// SQLite Relations
export const appsRelationsSqlite = relations(appsTableSqlite, ({ many }) => ({
  routes: many(routesTableSqlite),
  appStorages: many(appStorageTableSqlite),
}));

export const domainsRelationsSqlite = relations(
  domainsTableSqlite,
  ({ many }) => ({
    routes: many(routesTableSqlite),
  })
);

export const routesRelationsSqlite = relations(
  routesTableSqlite,
  ({ one }) => ({
    domain: one(domainsTableSqlite, {
      fields: [routesTableSqlite.domainId],
      references: [domainsTableSqlite.id],
    }),
    app: one(appsTableSqlite, {
      fields: [routesTableSqlite.appId],
      references: [appsTableSqlite.id],
    }),
  })
);

export const storagesRelationsSqlite = relations(
  storagesTableSqlite,
  ({ many }) => ({
    appStorages: many(appStorageTableSqlite),
  })
);

export const appStorageRelationsSqlite = relations(
  appStorageTableSqlite,
  ({ one }) => ({
    app: one(appsTableSqlite, {
      fields: [appStorageTableSqlite.appId],
      references: [appsTableSqlite.id],
    }),
    storage: one(storagesTableSqlite, {
      fields: [appStorageTableSqlite.storageId],
      references: [storagesTableSqlite.id],
    }),
  })
);

// PostgreSQL Relations
export const appsRelationsPostgres = relations(
  appsTablePostgres,
  ({ many }) => ({
    routes: many(routesTablePostgres),
    appStorages: many(appStorageTablePostgres),
  })
);

export const domainsRelationsPostgres = relations(
  domainsTablePostgres,
  ({ many }) => ({
    routes: many(routesTablePostgres),
  })
);

export const routesRelationsPostgres = relations(
  routesTablePostgres,
  ({ one }) => ({
    domain: one(domainsTablePostgres, {
      fields: [routesTablePostgres.domainId],
      references: [domainsTablePostgres.id],
    }),
    app: one(appsTablePostgres, {
      fields: [routesTablePostgres.appId],
      references: [appsTablePostgres.id],
    }),
  })
);

export const storagesRelationsPostgres = relations(
  storagesTablePostgres,
  ({ many }) => ({
    appStorages: many(appStorageTablePostgres),
  })
);

export const appStorageRelationsPostgres = relations(
  appStorageTablePostgres,
  ({ one }) => ({
    app: one(appsTablePostgres, {
      fields: [appStorageTablePostgres.appId],
      references: [appsTablePostgres.id],
    }),
    storage: one(storagesTablePostgres, {
      fields: [appStorageTablePostgres.storageId],
      references: [storagesTablePostgres.id],
    }),
  })
);
