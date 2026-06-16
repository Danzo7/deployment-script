import { createHash } from 'crypto';
import { Logger } from './logger.js';
import { Storage } from '../db/model.js';
import fs from  'fs';
import path from 'path';
import fsExtra from 'fs-extra';

export const calculateFileHash = (filePath: string): string => {
  if (!fs.existsSync(filePath)) return '';
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(fileContent).digest('hex');
};


export const isDirectoryEmpty = (dir: string): boolean =>
  fs.existsSync(dir) &&
  fs.statSync(dir).isDirectory() &&
  fs.readdirSync(dir).length === 0;

export const ensureDirectories = (appDir: string) => {
  const relDir = path.join(appDir, 'release');
  const envDir = path.join(appDir, 'env');
  const logDir = path.join(appDir, 'logs');
  Logger.info(`Checking directories...`);
  if (!fs.existsSync(relDir)) {
    fs.mkdirSync(relDir, { recursive: true });
    Logger.success(`Created directory ${relDir}`);
  }
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
    Logger.success(`created directory ${envDir}`);
  }

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    Logger.success(`created directory ${logDir}`);
  }
  return { relDir, envDir, logDir };
};

export const createBuildDir = (appDir: string, projectDir?: string): string => {
  const buildDir = path.join(appDir, 'builds','build-' + Date.now());
  const releaseDir = path.join(appDir, 'release');
  const envDir = path.join(appDir, 'env');
  const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;
   const nextConfigExts = ['.mjs','.js', '.ts','.cjs', '.json'];

  const nextFolder = path.join(sourceRoot, '.next');
  const publicFolder = path.join(sourceRoot, 'public');
  if(fs.existsSync(publicFolder)){
  const publicFolderDest = path.join(buildDir, 'public');
  fsExtra.copySync(publicFolder, publicFolderDest);}
if(!fs.existsSync(nextFolder)){
  throw new Error('Next.js build not found.');
}
   fs.mkdirSync(buildDir, { recursive: true });

  const nodeModulesSrc = path.join(sourceRoot, 'node_modules');
  if(!fs.existsSync(nodeModulesSrc)){
    throw new Error('Node modules not found.');
  }
  const nodeModulesDest = path.join(buildDir, 'node_modules');
  Logger.info('Linking node modules...');
  fs.symlinkSync(nodeModulesSrc, nodeModulesDest);


  const envLocalSrc = path.join(envDir, '.env.local');
  if(fs.existsSync(envLocalSrc)){
  const envLocalDest = path.join(buildDir, '.env.local');
   fs.copyFileSync(envLocalSrc, envLocalDest);}
   Logger.info('Linking .next folder...');
  const nextFolderDest = path.join(buildDir, '.next');
  fsExtra.copySync(nextFolder, nextFolderDest);

  //delete .next folder
  fsExtra.removeSync(nextFolder);

  nextConfigExts.forEach((ext)=>{
    const nextConfig = path.join(sourceRoot, 'next.config'+ext);
    if( fs.existsSync(nextConfig)){
      const nextConfigDest = path.join(buildDir, 'next.config'+ext);
       fs.copyFileSync(nextConfig, nextConfigDest);
    }
  });
  return buildDir;
};

export const createBuildDirForNestJS = (appDir: string, projectDir?: string): string => {
  const buildDir = path.join(appDir, 'builds', 'build-' + Date.now());
  const releaseDir = path.join(appDir, 'release');
  const envDir = path.join(appDir, 'env');
  const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;

  const distFolder = path.join(sourceRoot, 'dist');
  
  if (!fs.existsSync(distFolder)) {
    throw new Error('NestJS build not found. Make sure to run "npm run build" first.');
  }

  fs.mkdirSync(buildDir, { recursive: true });

  // Link node_modules
  const nodeModulesSrc = path.join(sourceRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesSrc)) {
    throw new Error('Node modules not found.');
  }
  const nodeModulesDest = path.join(buildDir, 'node_modules');
  Logger.info('Linking node modules...');
  fs.symlinkSync(nodeModulesSrc, nodeModulesDest);

  // Copy environment files
  const envLocalSrc = path.join(envDir, '.env');
  if (fs.existsSync(envLocalSrc)) {
    const envLocalDest = path.join(buildDir, '.env');
    fs.copyFileSync(envLocalSrc, envLocalDest);
  }

  // Copy production environment file if it exists
  const envProdSrc = path.join(envDir, '.env.production');
  if (fs.existsSync(envProdSrc)) {
    const envProdDest = path.join(buildDir, '.env.production');
    fs.copyFileSync(envProdSrc, envProdDest);
  }

  // Copy the dist folder
  const distFolderDest = path.join(buildDir, 'dist');
  fsExtra.copySync(distFolder, distFolderDest);

  // Delete dist folder from release directory
  fsExtra.removeSync(distFolder);

  // Copy package.json (needed for production dependencies info)
  const packageJsonSrc = path.join(sourceRoot, 'package.json');
  if (fs.existsSync(packageJsonSrc)) {
    const packageJsonDest = path.join(buildDir, 'package.json');
    fs.copyFileSync(packageJsonSrc, packageJsonDest);
  }
  return buildDir;
};

export const createBuildDirForDotnet = (appDir: string, projectDir?: string): string => {
  const buildDir = path.join(appDir, 'builds', 'build-' + Date.now());
  const releaseDir = path.join(appDir, 'release');
  const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;

  const publishFolder = path.join(sourceRoot, 'publish');

  fs.mkdirSync(buildDir, { recursive: true });

  // Copy publish/ contents into buildDir/publish/
  const publishDest = path.join(buildDir, 'publish');
  fsExtra.copySync(publishFolder, publishDest);

  // Delete release/publish/ to keep the release directory clean
  fsExtra.removeSync(publishFolder);

  return buildDir;
};

/**
 * Creates a build directory based on the project type
 * @param appDir The application directory
 * @param projectType The type of project ('nextjs' | 'nestjs' | 'dotnet')
 * @param projectDir Optional subdirectory within the release dir (for monorepos)
 * @param linkedStorages Optional array of Storage objects to symlink into the build dir
 * @returns The path to the created build directory
 */
export const createBuildDirByType = (
  appDir: string,
  projectType: 'nextjs' | 'nestjs' | 'dotnet',
  projectDir?: string,
  linkedStorages?: Storage[]): string => {
  let buildDir: string;
  switch (projectType) {
    case 'nestjs':
      buildDir = createBuildDirForNestJS(appDir, projectDir);
      break;
    case 'dotnet':
      buildDir = createBuildDirForDotnet(appDir, projectDir);
      break;
    case 'nextjs':
    default:
      buildDir = createBuildDir(appDir, projectDir);
      break;
  }
  applyStorageSymlinks(buildDir, linkedStorages ?? []);
  return buildDir;
};

/**
 * Creates storage symlinks inside a build directory for each linked storage.
 * Uses storage.linkName as the symlink name and storage.name (via storage.path) as the target.
 * Non-fatal: logs and skips on conflicts rather than throwing.
 *
 * @param buildDir The build directory to create symlinks in
 * @param linkedStorages Array of Storage objects to link
 */
export const applyStorageSymlinks = (buildDir: string, linkedStorages: Storage[] = []): void => {
  for (const storage of linkedStorages) {
    const linkPath = path.join(buildDir, storage.linkName);
    const targetPath = storage.path;

    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        Logger.warn(`applyStorageSymlinks: could not stat "${linkPath}": ${err.message}`);
        continue;
      }
      // ENOENT — path does not exist, proceed to create symlink
    }

    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(linkPath);
        if (existingTarget === targetPath) {
          // Correct symlink already exists — skip (idempotent)
          continue;
        } else {
          Logger.error(
            `applyStorageSymlinks: stale symlink at "${linkPath}" points to "${existingTarget}" instead of "${targetPath}". Skipping.`
          );
          continue;
        }
      } else {
        Logger.warn(
          `applyStorageSymlinks: a real file or directory already exists at "${linkPath}" (storage: "${storage.name}"). Skipping.`
        );
        continue;
      }
    }

    // Path does not exist — ensure storage directory exists and create symlink
    fs.mkdirSync(targetPath, { recursive: true });
    fs.symlinkSync(targetPath, linkPath);
    Logger.success(`Linked storage "${storage.name}" (${storage.linkName}) → "${targetPath}"`);
  }
};