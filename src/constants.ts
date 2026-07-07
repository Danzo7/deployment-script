import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';


export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)),"..");
dotenv.config({path: path.join(ROOT_DIR, '.env')});

// Application directories
export const APP_DIR =
  process.env?.APP_DIR ?? path.join(ROOT_DIR, '.applications');
export const NEXT_DIR = process.env?.NEXT_DIR ?? APP_DIR;
export const NEST_DIR = process.env?.NEST_DIR ?? APP_DIR;
export const DOTNET_DIR = process.env?.DOTNET_DIR ?? APP_DIR;
export const STATIC_DIR = process.env?.STATIC_DIR ?? APP_DIR;
export const STORAGE_DIR =
  process.env.STORAGE_DIR ?? path.join(APP_DIR, 'storages');
export const DOMAINS_DIR =
  process.env.DOMAINS_DIR ?? path.join(ROOT_DIR, '.domains');
export const LOCK_DIR = path.resolve(ROOT_DIR, '.locks');

// Nginx and remote deployment configuration
export const PUSH_CERT_DIR = process.env.PUSH_CERT_DIR ?? undefined;
export const NGINX_REMOTE_HOST = process.env.NGINX_REMOTE_HOST ?? undefined;
export const NGINX_REMOTE_KEY = process.env.NGINX_REMOTE_KEY ?? undefined;
export const NGINX_REMOTE_PASSWORD = process.env.NGINX_REMOTE_PASSWORD ?? undefined;
export const NGINX_SUDO_PASSWORD = process.env.NGINX_SUDO_PASSWORD ?? undefined;
export const PROXY_TARGET_HOST = process.env?.PROXY_TARGET_HOST ?? 'localhost';

// Database configuration
export const DATABASE_TYPE = (process.env.DATABASE_TYPE || 'sqlite') as 'sqlite' | 'postgres';
export const DATABASE_URL = process.env.DATABASE_URL ?? undefined;

// Security
export const SECRET_KEY = process.env.SECRET_KEY ?? undefined;

// Remote SSH access
export const REMOTE_PORT = parseInt(process.env.REMOTE_PORT ?? '2022', 10);
export const REMOTE_DIR = path.join(ROOT_DIR, '.remote');
export const REMOTE_HOST_KEY_PATH = path.join(REMOTE_DIR, 'host_ed25519_key');
export const REMOTE_AUTHORIZED_KEYS_PATH = path.join(REMOTE_DIR, 'authorized_keys');
export const REMOTE_LOGIN_ATTEMPTS_PATH = path.join(REMOTE_DIR, 'login_attempts.json');
export const REMOTE_AUDIT_LOG_PATH = path.join(REMOTE_DIR, 'audit.log');
export const REMOTE_KNOWN_HOSTS_PATH = path.join(REMOTE_DIR, 'known_hosts.json');
