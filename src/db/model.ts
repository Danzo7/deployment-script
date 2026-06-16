export interface App {
  id: string; // Unique identifier for the app
  name: string; // Unique name of the app
  appDir: string; // Directory path for the app
  createdAt: string; // ISO string for creation date
  updatedAt: string; // ISO string for last update date
  port: number; // Unique port number for the app
  instances?: number; // Number of instances (default 1)
  repo: string; // Repository URL or path
  branch: string; // Branch name
  url?: string; // Public URL or domain for the app
  lastDeploy?: string; // Optional ISO string for last deployment date
  builds?: string[];
  activeBuild?: string; // path to the active build directory
  projectType: 'nextjs' | 'nestjs' | 'dotnet'; // Project framework type
  projectDir?: string; // Optional subdirectory within the repo that contains the project (for monorepos)
  linkedStorages?: string[]; // Names of storages attached to this app
}

export interface Storage {
  id: string; // UUID v4, generated at creation
  name: string; // Unique human-readable identifier
  path: string; // Absolute path: STORAGE_DIR/name
  createdAt: string; // ISO 8601 timestamp at creation
}
