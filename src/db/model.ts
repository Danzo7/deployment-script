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
  lastDeploy?: string; // Optional ISO string for last deployment date
  builds?: string[]; 
  activeBuild?: number;
  projectType?: 'nextjs' | 'nestjs'; // Project framework type
}
