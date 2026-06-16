import { JSONFileSync } from 'lowdb/node';
import { App, Storage } from './model.js';
import { LowSync } from 'lowdb';
import path from 'path';
import { APP_DIR } from '../constants.js';

interface DatabaseSchema {
  apps: App[]; // Array of applications
  storages: Storage[]; // Array of storage volumes
}

// Initialize LowDB
const adapter = new JSONFileSync<DatabaseSchema>(path.resolve(APP_DIR, 'db.json')); // Path to the JSON file
const db = new LowSync(adapter, { apps: [], storages: [] });

/**
 * Initializes the database.
 * Ensures the database file has default data if it's empty.
 */
export const initializeDB = () => {
  db.read(); // Load the data from the JSON file

  // Provide default structure if the database is empty
  db.data ||= { apps: [], storages: [] };

  // Migrate: add storages array if missing (db.json created before storage feature)
  if (!db.data.storages) {
    db.data.storages = [];
    db.write();
  }
};

/**
 * Get the LowDB instance.
 * Ensure the database is initialized before using.
 */
export const getDB = () => {
  if (!db.data) {
    throw new Error('Database is not initialized. Call initializeDB() first.');
  }
  return db;
};
