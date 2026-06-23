import { drizzle as drizzleSqlite, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'path';
import { APP_DIR, DATABASE_TYPE, DATABASE_URL } from '../constants.js';
import * as schema from './schema.js';

// Type for the database instance
type DrizzleDB = BetterSQLite3Database<typeof schema> | NodePgDatabase<typeof schema>;

let db: DrizzleDB | null = null;
let sqliteInstance: Database.Database | null = null;
let postgresInstance: pg.Client | null = null;

/**
 * Get or create the database connection
 */
function getConnection(): DrizzleDB {
  if (db) return db;

  if (DATABASE_TYPE === 'postgres') {
    const connectionString = DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL');
    }
    postgresInstance = new pg.Client({ connectionString });
    postgresInstance.connect();
    db = drizzlePostgres(postgresInstance, { schema }) as DrizzleDB;
  } else {
    // SQLite
    const dbPath = path.resolve(APP_DIR, 'db.sqlite');
    sqliteInstance = new Database(dbPath);
    db = drizzleSqlite(sqliteInstance, { schema }) as DrizzleDB;
  }

  return db;
}

/**
 * Initializes the database.
 * Creates tables if they don't exist.
 */
export const initializeDB = async () => {
  getConnection();
  
  // For SQLite, enable foreign keys and create tables
  if (DATABASE_TYPE === 'sqlite' && sqliteInstance) {
    sqliteInstance.pragma('foreign_keys = ON');
    
    // Create tables if they don't exist
    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        appDir TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        port INTEGER NOT NULL,
        instances INTEGER DEFAULT 1,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        vcsType TEXT DEFAULT 'git',
        lastDeploy INTEGER,
        builds TEXT,
        activeBuild TEXT,
        projectType TEXT NOT NULL,
        projectDir TEXT,
        lastDeployedCommit TEXT
      );
      CREATE INDEX IF NOT EXISTS apps_name_idx ON apps(name);
      CREATE INDEX IF NOT EXISTS apps_port_idx ON apps(port);

      CREATE TABLE IF NOT EXISTS storages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        linkName TEXT,
        path TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS storages_name_idx ON storages(name);

      CREATE TABLE IF NOT EXISTS domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        ssl TEXT NOT NULL,
        headers TEXT,
        lastPushedAt INTEGER,
        configPath TEXT,
        lastCompiledAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS domains_name_idx ON domains(name);

      CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domainId INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        appId INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        headers TEXT
      );
      CREATE INDEX IF NOT EXISTS routes_domain_id_idx ON routes(domainId);
      CREATE INDEX IF NOT EXISTS routes_domain_path_idx ON routes(domainId, path);
      CREATE INDEX IF NOT EXISTS routes_app_id_idx ON routes(appId);

      CREATE TABLE IF NOT EXISTS app_storage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appId INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        storageId INTEGER NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_storage_app_id_idx ON app_storage(appId);
      CREATE INDEX IF NOT EXISTS app_storage_storage_id_idx ON app_storage(storageId);
    `);
  } else if (DATABASE_TYPE === 'postgres' && postgresInstance) {
    // For PostgreSQL, create tables using CREATE IF NOT EXISTS
    await postgresInstance.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        app_dir VARCHAR(500) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        port INTEGER NOT NULL,
        instances INTEGER DEFAULT 1,
        repo TEXT NOT NULL,
        branch VARCHAR(255) NOT NULL,
        vcs_type VARCHAR(10) DEFAULT 'git',
        last_deploy TIMESTAMP,
        builds JSONB,
        active_build VARCHAR(500),
        project_type VARCHAR(20) NOT NULL,
        project_dir VARCHAR(255),
        last_deployed_commit JSONB
      );
      CREATE INDEX IF NOT EXISTS apps_name_idx ON apps(name);
      CREATE INDEX IF NOT EXISTS apps_port_idx ON apps(port);

      CREATE TABLE IF NOT EXISTS storages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        link_name VARCHAR(255),
        path VARCHAR(500) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS storages_name_idx ON storages(name);

      CREATE TABLE IF NOT EXISTS domains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ssl JSONB NOT NULL,
        headers JSONB,
        last_pushed_at TIMESTAMP,
        config_path VARCHAR(500),
        last_compiled_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS domains_name_idx ON domains(name);

      CREATE TABLE IF NOT EXISTS routes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        path VARCHAR(500) NOT NULL,
        app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        headers JSONB
      );
      CREATE INDEX IF NOT EXISTS routes_domain_id_idx ON routes(domain_id);
      CREATE INDEX IF NOT EXISTS routes_domain_path_idx ON routes(domain_id, path);
      CREATE INDEX IF NOT EXISTS routes_app_id_idx ON routes(app_id);

      CREATE TABLE IF NOT EXISTS app_storage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        storage_id UUID NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS app_storage_app_id_idx ON app_storage(app_id);
      CREATE INDEX IF NOT EXISTS app_storage_storage_id_idx ON app_storage(storage_id);
    `);
  }
};

/**
 * Get the database instance.
 * Ensure the database is initialized before using.
 */
export const getDB = (): DrizzleDB => {
  if (!db) {
    console.warn('\n⚠️  WARNING: Database is not initialized!');
    console.warn('Run "dm migrate-db" to initialize and migrate your database.\n');
    throw new Error('Database not initialized. Run "dm migrate-db" first.');
  }
  return db;
};

/**
 * Close the database connection
 */
export const closeDB = async () => {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
  }
  if (postgresInstance) {
    await postgresInstance.end();
    postgresInstance = null;
  }
  db = null;
};
