import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROOT_DIR } from '../constants.js';

/**
 * Creates a default .env file in ~/.dm/ if one doesn't exist.
 * Copies from .env.example if available in the installation directory.
 */
export function ensureDefaultConfig(): void {
  const userEnvPath = path.join(ROOT_DIR, '.env');
  
  // If .env already exists, we're good
  if (fs.existsSync(userEnvPath)) {
    return;
  }

  // Ensure ROOT_DIR exists before writing .env
  if (!fs.existsSync(ROOT_DIR)) {
    fs.mkdirSync(ROOT_DIR, { recursive: true });
  }

  // Try to find .env.example in the installation directory
  const currentFile = fileURLToPath(import.meta.url);
  const installDir = path.resolve(path.dirname(currentFile), '../..');
  const examplePath = path.join(installDir, '.env.example');

  let envContent = '';

  if (fs.existsSync(examplePath)) {
    // Copy from .env.example
    envContent = fs.readFileSync(examplePath, 'utf-8');
  } else {
    // Fallback: create a minimal .env
    envContent = `# dm configuration
# Generated on first run - customize as needed

# Database Configuration
DATABASE_TYPE=sqlite

# For PostgreSQL, uncomment and configure:
# DATABASE_URL=postgresql://user:password@localhost:5432/deployment_manager

# Secret key for delete operations
# SECRET_KEY=your_secret_key_here

# Remote SSH access port (default: 2022)
# REMOTE_PORT=2022

# Remote SSH server bind address (default: 127.0.0.1)
# REMOTE_BIND=127.0.0.1
`;
  }

  // Write to user's dm directory
  fs.writeFileSync(userEnvPath, envContent, 'utf-8');
}

/**
 * Checks if this is the first run by looking for the dm data directory.
 */
export function isFirstRun(): boolean {
  return !fs.existsSync(ROOT_DIR);
}

/**
 * Returns the location of the active .env file, or null if not found.
 */
export function getActiveEnvPath(): string | null {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(ROOT_DIR, '.env'),
  ];

  return candidates.find((p) => fs.existsSync(p)) || null;
}
