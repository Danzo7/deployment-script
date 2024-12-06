
import {  JSONFileSync } from 'lowdb/node';
import { App } from './model.js';
import { LowSync } from 'lowdb';


interface DatabaseSchema {
  apps: App[]; // Array of applications
}

// Initialize LowDB
const adapter = new JSONFileSync<DatabaseSchema>('db.json'); // Path to the JSON file
const db = new LowSync(adapter,{apps:[]});

/**
 * Initializes the database.
 * Ensures the database file has default data if it's empty.
 */
export const initializeDB =  () => {
   db.read(); // Load the data from the JSON file

  // Provide default structure if the database is empty
  db.data ||= { apps: [] };

  // Save initial data if the database was empty
   db.write();
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