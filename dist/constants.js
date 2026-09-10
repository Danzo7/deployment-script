import path, { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { existsSync } from "fs";
import dotenv from "dotenv";
const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function getDmDataDir() {
  if (process.env.DM_ROOT) {
    return resolve(process.env.DM_ROOT);
  }
  return path.join(homedir(), ".dm");
}
function findEnvFile() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(getDmDataDir(), ".env"),
    path.join(INSTALL_DIR, ".env")
  ];
  return candidates.find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  }) || candidates[1];
}
dotenv.config({ path: findEnvFile() });
const ROOT_DIR = getDmDataDir();
const APP_DIR = process.env?.APP_DIR ?? path.join(ROOT_DIR, "applications");
const NEXT_DIR = process.env?.NEXT_DIR ?? APP_DIR;
const NEST_DIR = process.env?.NEST_DIR ?? APP_DIR;
const DOTNET_DIR = process.env?.DOTNET_DIR ?? APP_DIR;
const STATIC_DIR = process.env?.STATIC_DIR ?? APP_DIR;
const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(APP_DIR, "storages");
const DOMAINS_DIR = process.env.DOMAINS_DIR ?? path.join(ROOT_DIR, "domains");
const LOCK_DIR = process.env.LOCK_DIR ?? path.join(ROOT_DIR, "locks");
const PUSH_CERT_DIR = process.env.PUSH_CERT_DIR ?? void 0;
const NGINX_REMOTE_HOST = process.env.NGINX_REMOTE_HOST ?? void 0;
const NGINX_REMOTE_KEY = process.env.NGINX_REMOTE_KEY ?? void 0;
const NGINX_REMOTE_PASSWORD = process.env.NGINX_REMOTE_PASSWORD ?? void 0;
const NGINX_SUDO_PASSWORD = process.env.NGINX_SUDO_PASSWORD ?? void 0;
const PROXY_TARGET_HOST = process.env?.PROXY_TARGET_HOST ?? "localhost";
const DATABASE_TYPE = process.env.DATABASE_TYPE || "sqlite";
const DATABASE_URL = process.env.DATABASE_URL ?? void 0;
const SECRET_KEY = process.env.SECRET_KEY ?? void 0;
const REMOTE_PORT = parseInt(process.env.REMOTE_PORT ?? "2022", 10);
const REMOTE_DIR = process.env.REMOTE_DIR ?? path.join(ROOT_DIR, "remote");
const REMOTE_HOST_KEY_PATH = path.join(REMOTE_DIR, "host_ed25519_key");
const REMOTE_AUTHORIZED_KEYS_PATH = path.join(
  REMOTE_DIR,
  "authorized_keys"
);
const REMOTE_LOGIN_ATTEMPTS_PATH = path.join(
  REMOTE_DIR,
  "login_attempts.json"
);
const REMOTE_AUDIT_LOG_PATH = path.join(REMOTE_DIR, "audit.log");
const REMOTE_KNOWN_HOSTS_PATH = path.join(
  REMOTE_DIR,
  "known_hosts.json"
);
export {
  APP_DIR,
  DATABASE_TYPE,
  DATABASE_URL,
  DOMAINS_DIR,
  DOTNET_DIR,
  LOCK_DIR,
  NEST_DIR,
  NEXT_DIR,
  NGINX_REMOTE_HOST,
  NGINX_REMOTE_KEY,
  NGINX_REMOTE_PASSWORD,
  NGINX_SUDO_PASSWORD,
  PROXY_TARGET_HOST,
  PUSH_CERT_DIR,
  REMOTE_AUDIT_LOG_PATH,
  REMOTE_AUTHORIZED_KEYS_PATH,
  REMOTE_DIR,
  REMOTE_HOST_KEY_PATH,
  REMOTE_KNOWN_HOSTS_PATH,
  REMOTE_LOGIN_ATTEMPTS_PATH,
  REMOTE_PORT,
  ROOT_DIR,
  SECRET_KEY,
  STATIC_DIR,
  STORAGE_DIR
};
