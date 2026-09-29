import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

// ============================================================================
// PATH RESOLUTION STRATEGY
// ============================================================================
// dm uses a system-wide data directory by default:
//   Windows: C:\ProgramData\deployment-manager\
//   Linux:   /opt/deployment-manager/
//
// This ensures consistency when services run as SYSTEM/root and when users
// run commands directly - all contexts access the same application data.
//
// Priority order for finding .env:
// 1. Current working directory (.env)
// 2. System data directory (ProgramData/opt)
// 3. Installation directory (fallback for dev/legacy)
//
// DM_ROOT can override the data directory location via environment variable.
// ============================================================================

const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Resolves the dm data directory.
 * Uses system-wide locations to ensure consistency across user contexts.
 */
function getDmDataDir(): string {
  if (process.env.DM_ROOT) {
    return resolve(process.env.DM_ROOT);
  }
  
  if (process.platform === 'win32') {
    return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'deployment-manager');
  } else {
    return '/opt/deployment-manager';
  }
}

function findEnvFile(): string {
  const candidates = [
    path.join(INSTALL_DIR, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(getDmDataDir(), '.env'),
  ];

  return candidates.find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  }) || candidates[1]; // Default to user data dir if none found
}

// Load environment variables
dotenv.config({ path: findEnvFile() });

export const ROOT_DIR = getDmDataDir();

// Application directories - all configurable via env vars with sensible defaults
export const APP_DIR =
  process.env?.APP_DIR ?? path.join(ROOT_DIR, 'applications');
export const NEXT_DIR = process.env?.NEXT_DIR ?? APP_DIR;
export const NEST_DIR = process.env?.NEST_DIR ?? APP_DIR;
export const DOTNET_DIR = process.env?.DOTNET_DIR ?? APP_DIR;
export const STATIC_DIR = process.env?.STATIC_DIR ?? APP_DIR;
export const STORAGE_DIR =
  process.env.STORAGE_DIR ?? path.join(APP_DIR, 'storages');
export const DOMAINS_DIR =
  process.env.DOMAINS_DIR ?? path.join(ROOT_DIR, 'domains');
export const LOCK_DIR = process.env.LOCK_DIR ?? path.join(ROOT_DIR, 'locks');

// Nginx and remote deployment configuration
export const PUSH_CERT_DIR = process.env.PUSH_CERT_DIR ?? undefined;
export const NGINX_REMOTE_HOST = process.env.NGINX_REMOTE_HOST ?? undefined;
export const NGINX_REMOTE_KEY = process.env.NGINX_REMOTE_KEY ?? undefined;
export const NGINX_REMOTE_PASSWORD =
  process.env.NGINX_REMOTE_PASSWORD ?? undefined;
export const NGINX_SUDO_PASSWORD = process.env.NGINX_SUDO_PASSWORD ?? undefined;
export const PROXY_TARGET_HOST = process.env?.PROXY_TARGET_HOST ?? 'localhost';

// Database configuration
export const DATABASE_TYPE = (process.env.DATABASE_TYPE || 'sqlite') as
  | 'sqlite'
  | 'postgres';
export const DATABASE_URL = process.env.DATABASE_URL ?? undefined;

// Security
export const SECRET_KEY = process.env.SECRET_KEY ?? undefined;
export const DB_CRED_KEY = process.env.DB_CRED_KEY ?? SECRET_KEY;

// Remote SSH access - stored in data directory
export const REMOTE_PORT = parseInt(process.env.REMOTE_PORT ?? '2022', 10);
export const REMOTE_DIR = process.env.REMOTE_DIR ?? path.join(ROOT_DIR, 'remote');
export const REMOTE_HOST_KEY_PATH = path.join(REMOTE_DIR, 'host_ed25519_key');
export const REMOTE_AUTHORIZED_KEYS_PATH = path.join(
  REMOTE_DIR,
  'authorized_keys'
);
export const REMOTE_LOGIN_ATTEMPTS_PATH = path.join(
  REMOTE_DIR,
  'login_attempts.json'
);
export const REMOTE_AUDIT_LOG_PATH = path.join(REMOTE_DIR, 'audit.log');
export const REMOTE_IPC_SOCKET_PATH = 
  process.platform === 'win32'
    ? '\\\\.\\pipe\\dm-remote'
    : path.join(REMOTE_DIR, 'dm-remote.sock');
export const REMOTE_PID_FILE_PATH = path.join(REMOTE_DIR, 'dm-remote.pid');
export const REMOTE_KNOWN_HOSTS_PATH = path.join(
  REMOTE_DIR,
  'known_hosts.json'
);

// Database migration tools
export const PG_SCHEMA_DIFF_DIR = process.env.PG_SCHEMA_DIFF_DIR ?? path.join(INSTALL_DIR, 'tools', 'pg-schema-diff');

// Database connection defaults
export const DB_DEFAULT_HOST = process.env.DB_DEFAULT_HOST ?? 'localhost';
export const DB_DEFAULT_PORT = process.env.DB_DEFAULT_PORT ? parseInt(process.env.DB_DEFAULT_PORT, 10) : 5432;

// Schema diff connection (user with CREATEDB privilege for temp database creation)
export const DB_COMPARE_USER = process.env.DB_COMPARE_USER ?? undefined;
export const DB_COMPARE_PASSWORD = process.env.DB_COMPARE_PASSWORD ?? undefined;
