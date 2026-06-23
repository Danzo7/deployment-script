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
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        app_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        port INTEGER NOT NULL,
        instances INTEGER DEFAULT 1,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        vcs_type TEXT DEFAULT 'git',
        last_deploy TEXT,
        builds TEXT,
        active_build TEXT,
        project_type TEXT NOT NULL,
        project_dir TEXT,
        linked_storages TEXT,
        last_deployed_commit TEXT
      );
      CREATE INDEX IF NOT EXISTS apps_name_idx ON apps(name);
      CREATE INDEX IF NOT EXISTS apps_port_idx ON apps(port);

      CREATE TABLE IF NOT EXISTS storages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        link_name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS storages_name_idx ON storages(name);

      CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ssl TEXT NOT NULL,
        headers TEXT,
        last_pushed_at TEXT,
        config_path TEXT,
        last_compiled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS domains_name_idx ON domains(name);

      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        app_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        headers TEXT
      );
      CREATE INDEX IF NOT EXISTS routes_domain_id_idx ON routes(domain_id);
      CREATE INDEX IF NOT EXISTS routes_domain_path_idx ON routes(domain_id, path);
    `);
  } else if (DATABASE_TYPE === 'postgres' && postgresInstance) {
    // For PostgreSQL, create tables using CREATE IF NOT EXISTS
    await postgresInstance.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        app_dir VARCHAR(500) NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
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
        linked_storages JSONB,
        last_deployed_commit JSONB
      );
      CREATE INDEX IF NOT EXISTS apps_name_idx ON apps(name);
      CREATE INDEX IF NOT EXISTS apps_port_idx ON apps(port);

      CREATE TABLE IF NOT EXISTS storages (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        link_name VARCHAR(255) NOT NULL,
        path VARCHAR(500) NOT NULL,
        created_at TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS storages_name_idx ON storages(name);

      CREATE TABLE IF NOT EXISTS domains (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        ssl JSONB NOT NULL,
        headers JSONB,
        last_pushed_at TIMESTAMP,
        config_path VARCHAR(500),
        last_compiled_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS domains_name_idx ON domains(name);

      CREATE TABLE IF NOT EXISTS routes (
        id UUID PRIMARY KEY,
        domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        path VARCHAR(500) NOT NULL,
        app_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        headers JSONB
      );
      CREATE INDEX IF NOT EXISTS routes_domain_id_idx ON routes(domain_id);
      CREATE INDEX IF NOT EXISTS routes_domain_path_idx ON routes(domain_id, path);
    `);
  }
};

/**
 * Get the database instance.
 * Ensure the database is initialized before using.
 */
export const getDB = (): DrizzleDB => {
  if (!db) {
    throw new Error('Database is not initialized. Call initializeDB() first.');
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
