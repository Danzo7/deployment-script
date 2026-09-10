import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { existsSync } from 'fs';
import dotenv from 'dotenv';
// ============================================================================
// PATH RESOLUTION STRATEGY
// ============================================================================
// dm uses ~/.dm/ as its data directory by default (cross-platform).
// This allows npm installation without polluting node_modules.
//
// Priority order for finding .env:
// 1. Current working directory (.env)
// 2. User data directory (~/.dm/.env)
// 3. Installation directory (fallback for dev/legacy)
//
// DM_ROOT can override the data directory location via environment variable.
// ============================================================================
const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Resolves the dm data directory.
 * Cross-platform: uses ~/.dm on both Windows and Unix.
 */
function getDmDataDir() {
    if (process.env.DM_ROOT) {
        return resolve(process.env.DM_ROOT);
    }
    return path.join(homedir(), '.dm');
}
/**
 * Finds the .env file in priority order:
 * 1. Current working directory
 * 2. User data directory (~/.dm/)
 * 3. Installation directory (dev/legacy fallback)
 */
function findEnvFile() {
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(getDmDataDir(), '.env'),
        path.join(INSTALL_DIR, '.env'),
    ];
    return candidates.find((p) => {
        try {
            return existsSync(p);
        }
        catch {
            return false;
        }
    }) || candidates[1]; // Default to user data dir if none found
}
// Load environment variables
dotenv.config({ path: findEnvFile() });
export const ROOT_DIR = getDmDataDir();
// Application directories - all configurable via env vars with sensible defaults
export const APP_DIR = process.env?.APP_DIR ?? path.join(ROOT_DIR, 'applications');
export const NEXT_DIR = process.env?.NEXT_DIR ?? APP_DIR;
export const NEST_DIR = process.env?.NEST_DIR ?? APP_DIR;
export const DOTNET_DIR = process.env?.DOTNET_DIR ?? APP_DIR;
export const STATIC_DIR = process.env?.STATIC_DIR ?? APP_DIR;
export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(APP_DIR, 'storages');
export const DOMAINS_DIR = process.env.DOMAINS_DIR ?? path.join(ROOT_DIR, 'domains');
export const LOCK_DIR = process.env.LOCK_DIR ?? path.join(ROOT_DIR, 'locks');
// Nginx and remote deployment configuration
export const PUSH_CERT_DIR = process.env.PUSH_CERT_DIR ?? undefined;
export const NGINX_REMOTE_HOST = process.env.NGINX_REMOTE_HOST ?? undefined;
export const NGINX_REMOTE_KEY = process.env.NGINX_REMOTE_KEY ?? undefined;
export const NGINX_REMOTE_PASSWORD = process.env.NGINX_REMOTE_PASSWORD ?? undefined;
export const NGINX_SUDO_PASSWORD = process.env.NGINX_SUDO_PASSWORD ?? undefined;
export const PROXY_TARGET_HOST = process.env?.PROXY_TARGET_HOST ?? 'localhost';
// Database configuration
export const DATABASE_TYPE = (process.env.DATABASE_TYPE || 'sqlite');
export const DATABASE_URL = process.env.DATABASE_URL ?? undefined;
// Security
export const SECRET_KEY = process.env.SECRET_KEY ?? undefined;
// Remote SSH access - stored in data directory
export const REMOTE_PORT = parseInt(process.env.REMOTE_PORT ?? '2022', 10);
export const REMOTE_DIR = process.env.REMOTE_DIR ?? path.join(ROOT_DIR, 'remote');
export const REMOTE_HOST_KEY_PATH = path.join(REMOTE_DIR, 'host_ed25519_key');
export const REMOTE_AUTHORIZED_KEYS_PATH = path.join(REMOTE_DIR, 'authorized_keys');
export const REMOTE_LOGIN_ATTEMPTS_PATH = path.join(REMOTE_DIR, 'login_attempts.json');
export const REMOTE_AUDIT_LOG_PATH = path.join(REMOTE_DIR, 'audit.log');
export const REMOTE_KNOWN_HOSTS_PATH = path.join(REMOTE_DIR, 'known_hosts.json');
