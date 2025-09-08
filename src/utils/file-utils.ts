import { createHash } from 'crypto';
import { Logger } from './logger.js';
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

export const createBuildDir =  (appDir: string): string => {
  const buildDir = path.join(appDir, 'builds','build-' + Date.now());
  const releaseDir = path.join(appDir, 'release');
  const envDir = path.join(appDir, 'env');
   const nextConfigExts = ['.mjs','.js', '.ts','.cjs', '.json'];

  const nextFolder = path.join(releaseDir, '.next');
  const publicFolder = path.join(releaseDir, 'public');
  if(fs.existsSync(publicFolder)){
  const publicFolderDest = path.join(buildDir, 'public');
  fsExtra.copySync(publicFolder, publicFolderDest);}
if(!fs.existsSync(nextFolder)){
  throw new Error('Next.js build not found.');
}
   fs.mkdirSync(buildDir, { recursive: true });

  const nodeModulesSrc = path.join(releaseDir, 'node_modules');
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
  const nextFolderDest = path.join(buildDir, '.next');
  fsExtra.copySync(nextFolder, nextFolderDest);

  //delete .next folder
  fsExtra.removeSync(nextFolder);

  nextConfigExts.forEach((ext)=>{
    const nextConfig = path.join(releaseDir, 'next.config'+ext);
    if( fs.existsSync(nextConfig)){
      const nextConfigDest = path.join(buildDir, 'next.config'+ext);
       fs.copyFileSync(nextConfig, nextConfigDest);
    }
  });
  return buildDir;
};