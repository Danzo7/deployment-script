export interface App {
  id: string | number; // UUID (PostgreSQL) or auto-increment integer (SQLite)
  name: string; // Unique name of the app
  appDir: string; // Directory path for the app
  createdAt: Date; // Database-generated creation timestamp
  updatedAt: Date; // Last update timestamp
  port: number; // Unique port number for the app
  instances?: number; // Number of instances (default 1)
  repo: string; // Repository URL or path
  branch: string; // Branch name or SVN path suffix (e.g. trunk, branches/x)
  vcsType?: 'git' | 'svn' | 'local'; // Version control system (default: git)
  lastDeploy?: Date; // Optional last deployment timestamp
  builds?: string[];
  activeBuild?: string; // path to the active build directory
  projectType: 'nextjs' | 'nestjs' | 'dotnet' | 'static'; // Project framework type
  projectDir?: string; // Optional subdirectory within the repo that contains the project (for monorepos)
  lastDeployedCommit?: {
    hash: string; // Short commit hash (7 chars) or SVN revision
    message: string; // Commit message
    author: string; // Commit author
    date: string; // ISO date string
  };
}

// Extended app with storages eagerly loaded
export interface AppWithStorages extends App {
  storages: Storage[];
}

// Extended app with storages and routes (with domains) eagerly loaded
export interface AppWithStoragesAndRoutes extends App {
  storages: Storage[];
  routes: RouteWithAppAndDomain[];
}

export interface Storage {
  id: string | number; // UUID (PostgreSQL) or auto-increment integer (SQLite)
  name: string; // Unique human-readable identifier (used as the storage directory name)
  linkName?: string | null; // Symlink name created inside each build directory (defaults to name if not provided)
  path: string; // Absolute path: STORAGE_DIR/name
  createdAt: Date; // Database-generated creation timestamp
}

// Extended storage with apps eagerly loaded
export interface StorageWithApps extends Storage {
  apps: App[];
}

export interface DomainSsl {
  mode: 'none' | 'letsencrypt' | 'custom';
  certPath?: string; // Absolute path to cert.pem in the Cert_Store
  keyPath?: string; // Absolute path to key.pem in the Cert_Store
  uploadedAt?: string; // ISO 8601 timestamp when cert was attached
  expiresAt?: string; // ISO 8601, parsed from cert via crypto.X509Certificate
  issuedTo?: string; // CN from cert subject
  issuer?: string; // Issuer CN
  sanDomains?: string[]; // Subject Alternative Names
}

export interface Domain {
  id: string | number; // UUID (PostgreSQL) or auto-increment integer (SQLite)
  name: string; // Normalized hostname, unique
  createdAt: Date; // Database-generated creation timestamp
  updatedAt: Date; // Last update timestamp
  ssl: DomainSsl;
  headers?: Record<string, string>; // HTTP response headers applied to all routes under this domain
  lastPushedAt?: Date; // Timestamp of most recent successful Nginx push
  configPath?: string; // Full path where the Nginx config is deployed (e.g. /etc/nginx/sites-available/api_example_com.conf)
  lastCompiledAt?: Date; // Timestamp of most recent successful compilation
}

export interface Route {
  id: string | number; // UUID (PostgreSQL) or auto-increment integer (SQLite)
  domainId: string | number; // References Domain.id
  path: string; // Normalized path stored without leading slash (e.g. "api", "admin/dashboard", "" for root); prepend "/" when displaying or generating nginx config
  appId: string | number; // References App.id
  createdAt: Date; // Database-generated creation timestamp
  updatedAt: Date; // Last update timestamp
  headers?: Record<string, string>; // HTTP response headers for this location block only
}

// Extended route with app details for display/processing
export interface RouteWithApp extends Route {
  app: App; // The full app object
}

// Extended route with domain details
export interface RouteWithDomain extends Route {
  domain: Domain; // The full domain object
}

// Extended route with both app and domain
export interface RouteWithAppAndDomain extends Route {
  app: App;
  domain: Domain;
}

// Extended domain with routes
export interface DomainWithRoutes extends Domain {
  routes: Route[];
}

// Extended domain with routes and apps
export interface DomainWithRoutesAndApps extends Domain {
  routes: RouteWithApp[];
}

export interface AppStorage {
  id: string | number; // UUID (PostgreSQL) or auto-increment integer (SQLite)
  appId: string | number; // References App.id
  storageId: string | number; // References Storage.id
  createdAt: Date; // Database-generated creation timestamp
}
