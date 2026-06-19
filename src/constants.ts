import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import dotenv from 'dotenv';


export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)),"..");
dotenv.config({path: path.join(ROOT_DIR, '.env')});
export const APP_DIR =
  process.env?.APP_DIR ?? path.join(ROOT_DIR, '.applications');
export const NEXT_DIR = process.env?.NEXT_DIR ?? APP_DIR;
export const NEST_DIR = process.env?.NEST_DIR ?? APP_DIR;
export const DOTNET_DIR = process.env?.DOTNET_DIR ?? APP_DIR;
export const STORAGE_DIR =
  process.env.STORAGE_DIR ?? path.join(APP_DIR, 'storages');
export const DOMAINS_DIR =
  process.env.DOMAINS_DIR ?? path.join(ROOT_DIR, '.domains');
export const CERT_DIR = process.env.CERT_DIR ?? undefined;
export const NGINX_REMOTE_HOST = process.env.NGINX_REMOTE_HOST ?? undefined;
export const NGINX_REMOTE_KEY = process.env.NGINX_REMOTE_KEY ?? path.join(homedir(), '.ssh', 'id_rsa');
export const NGINX_REMOTE_PASSWORD = process.env.NGINX_REMOTE_PASSWORD ?? undefined;
export const LOCK_DIR = path.resolve(ROOT_DIR, '.locks');
export const PROXY_TARGET_HOST = process.env?.PROXY_TARGET_HOST ?? 'localhost';
