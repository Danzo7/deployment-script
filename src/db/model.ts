export interface App {
  id: string; // Unique identifier for the app
  name: string; // Unique name of the app
  appDir: string; // Directory path for the app
  createdAt: string; // ISO string for creation date
  updatedAt: string; // ISO string for last update date
  port: number; // Unique port number for the app
  instances?: number; // Number of instances (default 1)
  repo: string; // Repository URL or path
  branch: string; // Branch name or SVN path suffix (e.g. trunk, branches/x)
  vcsType?: 'git' | 'svn'; // Version control system (default: git)
  url?: string; // Public URL or domain for the app
  lastDeploy?: string; // Optional ISO string for last deployment date
  builds?: string[];
  activeBuild?: string; // path to the active build directory
  projectType: 'nextjs' | 'nestjs' | 'dotnet'; // Project framework type
  projectDir?: string; // Optional subdirectory within the repo that contains the project (for monorepos)
  linkedStorages?: string[]; // Names of storages attached to this app
  lastDeployedCommit?: {
    hash: string;    // Short commit hash (7 chars) or SVN revision
    message: string; // Commit message
    author: string;  // Commit author
    date: string;    // ISO date string
  };
}

export interface Storage {
  id: string; // UUID v4, generated at creation
  name: string; // Unique human-readable identifier (used as the storage directory name)
  linkName: string; // Symlink name created inside each build directory
  path: string; // Absolute path: STORAGE_DIR/name
  createdAt: string; // ISO 8601 timestamp at creation
}

export interface Domain {
  id: string; // UUID v4, generated at creation
  name: string; // Normalized hostname, unique
  createdAt: string; // ISO 8601 timestamp at creation
  updatedAt: string; // ISO 8601 timestamp of last update
  ssl: {
    mode: 'none' | 'letsencrypt' | 'custom';
  };
}

export interface Route {
  id: string; // UUID v4, generated at creation
  domainId: string; // References Domain.id
  path: string; // Normalized path (always starts with /)
  appName: string; // References App.name
  createdAt: string; // ISO 8601 timestamp at creation
  updatedAt: string; // ISO 8601 timestamp of last update
}
