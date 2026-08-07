import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { prepareDotnet, checkDotnetInstalled, checkDotnetSdk, ensureAssemblyName, checkAppSettings } from '../utils/dotnet-helper.js';
import { applyStorageSymlinks } from '../utils/file-utils.js';
import { DOTNET_DIR } from '../constants.js';
import { registerHandler } from './registry.js';
import type { AppTypeHandler, BuildPm2ConfigInput, PrepareReleaseOptions, CreateBuildDirInput } from './registry.js';

const dotnetHandler: AppTypeHandler = {
  typeKey: 'dotnet',

  buildPm2Config(input: BuildPm2ConfigInput) {
    const { dir, name, port, config } = input;

    const dllPath = path.join(dir, `${name}.dll`);
    if (!fs.existsSync(dllPath)) {
      throw new Error(`DLL not found at ${dllPath}`);
    }

    return {
      name,
      cwd: dir,
      script: 'dotnet',
      args: dllPath,
      instances: 1,
      max_memory_restart: config.maxMemory,
      ...(config.autorestart !== null && config.autorestart !== undefined
        ? { autorestart: config.autorestart }
        : {}),
      ...(config.maxRestarts !== null && config.maxRestarts !== undefined
        ? { max_restarts: config.maxRestarts }
        : {}),
      ...(config.minUptime ? { min_uptime: config.minUptime as any } : {}),
      ...(config.restartDelay !== null && config.restartDelay !== undefined
        ? { restart_delay: config.restartDelay }
        : {}),
      ...(config.killTimeout !== null && config.killTimeout !== undefined
        ? { kill_timeout: config.killTimeout }
        : {}),
      env: {
        ASPNETCORE_ENVIRONMENT: 'Production',
        ASPNETCORE_URLS: `http://0.0.0.0:${port}`,
      },
    };
  },

  createBuildDir({ appDir, projectDir, storages }: CreateBuildDirInput): string {
    const buildDir = path.join(appDir, 'builds', 'build-' + Date.now());
    const releaseDir = path.join(appDir, 'release');
    const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;

    const publishFolder = path.join(sourceRoot, 'publish');

    fs.mkdirSync(buildDir, { recursive: true });
    fsExtra.copySync(publishFolder, buildDir);
    fsExtra.removeSync(publishFolder);

    applyStorageSymlinks(buildDir, storages ?? []);
    return buildDir;
  },

  getNginxLocationDirectives(): string[] {
    return [];
  },

  async prepareRelease(dir: string, opts: PrepareReleaseOptions): Promise<void> {
    // Validate SDK version and ensure assembly name match before building
    await checkDotnetSdk(dir);
    if (opts.appName) {
      await ensureAssemblyName(dir, opts.appName);
    }
    await prepareDotnet(dir, { logDir: opts.logDir });
  },

  async syncConfig(buildRelDir: string, envDir: string): Promise<boolean> {
    return checkAppSettings(buildRelDir, envDir);
  },
  getAppsDir(): string {
    return DOTNET_DIR;
  },

  getDisplayName(unicode: boolean): string {
    return unicode ? '🔷 .NET' : '.NET';
  },

  checkPrerequisites(): void {
    checkDotnetInstalled();
  },

  getExecMode(): 'cluster' | 'fork' {
    return 'fork';
  },

  supportsNodeArgs(): boolean {
    return false;
  },

  async detect(dir: string): Promise<number> {
    // Check for *.csproj files
    try {
      const entries = fs.readdirSync(dir);
      if (entries.some((f) => f.endsWith('.csproj'))) {
        return 95;
      }
    } catch {
      return 0;
    }

    // Check for global.json without .csproj
    if (fs.existsSync(path.join(dir, 'global.json'))) {
      return 60;
    }

    return 0;
  },
};

registerHandler(dotnetHandler);

export { dotnetHandler };
