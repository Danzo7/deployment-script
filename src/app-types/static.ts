import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Logger } from '../utils/logger.js';
import { applyStorageSymlinks } from '../utils/file-utils.js';
import { STATIC_DIR } from '../constants.js';
import { registerHandler } from './registry.js';
import type { AppTypeHandler, BuildPm2ConfigInput, PrepareReleaseOptions, CreateBuildDirInput } from './registry.js';

const _dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_SERVER_SCRIPT = resolve(_dirname, '..', 'static-server', 'serve.js');

const staticHandler: AppTypeHandler = {
  typeKey: 'static',

  buildPm2Config(input: BuildPm2ConfigInput) {
    const { name, port, config } = input;
    return {
      name,
      cwd: input.dir,
      script: STATIC_SERVER_SCRIPT,
      args: undefined,
      instances: config.instances,
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
      ...(config.nodeArgs ? { node_args: config.nodeArgs } : {}),
      env: {
        NODE_ENV: 'production',
        PORT: port.toString(),
      },
    };
  },

  createBuildDir({ appDir, projectDir, storages }: CreateBuildDirInput): string {
    const buildDir = path.join(appDir, 'builds', 'build-' + Date.now());
    const releaseDir = path.join(appDir, 'release');
    const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;

    const distFolder = path.join(sourceRoot, 'dist');
    const buildFolder = path.join(sourceRoot, 'build');
    const rootIndexHtml = path.join(sourceRoot, 'index.html');
    const packageJson = path.join(sourceRoot, 'package.json');

    let staticSource: string | undefined;

    if (fs.existsSync(distFolder)) {
      staticSource = distFolder;
    } else if (fs.existsSync(buildFolder)) {
      staticSource = buildFolder;
    } else if (fs.existsSync(rootIndexHtml)) {
      // Only allow root-level copying for pure HTML sites (no package.json)
      if (fs.existsSync(packageJson)) {
        throw new Error(
          `Found package.json but no build output folder.\n` +
            `For projects with package.json (React, Vite, etc.), you must build your site first.\n` +
            `Run "npm run build" locally and commit the dist/ or build/ folder to your repository.\n` +
            `Static apps with build processes are not built on the server.`
        );
      }
      staticSource = sourceRoot;
    }

    if (!staticSource) {
      throw new Error(
        `No static content found for static app.\n` +
          `Expected one of:\n` +
          `  - "dist/" folder with index.html inside ${sourceRoot}\n` +
          `  - "build/" folder with index.html inside ${sourceRoot}\n` +
          `  - "index.html" at root (only for pure HTML sites without package.json)\n` +
          `Make sure your site is built before deploying.`
      );
    }

    fs.mkdirSync(buildDir, { recursive: true });
    fsExtra.copySync(staticSource, buildDir);

    const sourceDesc = staticSource === sourceRoot ? 'root directory' : `"${path.basename(staticSource)}/" folder`;
    Logger.info(`Copied static content from ${sourceDesc} into build directory.`);

    applyStorageSymlinks(buildDir, storages ?? []);
    return buildDir;
  },

  getNginxLocationDirectives(): string[] {
    return [];
  },

  async prepareRelease(dir: string, opts: PrepareReleaseOptions): Promise<void> {
    void opts; // opts not used for static apps — no build step
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      throw new Error(
        'Static apps must have their output pre-built and committed.\n' +
          'Please build your project locally (e.g. "npm run build") and commit the dist/ or build/ folder to the repository.\n' +
          'dm does not run build steps for static apps.'
      );
    }
    // No package.json — nothing to do
  },

  getAppsDir(): string {
    return STATIC_DIR;
  },

  getExecMode(): 'cluster' | 'fork' {
    return 'cluster';
  },

  getDisplayName(unicode: boolean): string {
    return unicode ? '📄 Static' : 'Static';
  },

  async syncConfig(_buildRelDir: string, _envDir: string): Promise<boolean> {
    void _buildRelDir; void _envDir;
    return false;
  },

  async detect(dir: string): Promise<number> {
    // Look for an index.html inside dist/ or build/ — that's our signal for a static site
    const candidates = ['dist', 'build'];
    for (const folder of candidates) {
      const folderPath = path.join(dir, folder);
      if (
        fs.existsSync(folderPath) &&
        fs.statSync(folderPath).isDirectory() &&
        fs.existsSync(path.join(folderPath, 'index.html'))
      ) {
        return 85;
      }
    }

    // index.html at root (no package.json needed)
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return 70;
    }

    return 0;
  },
};

registerHandler(staticHandler);

export { staticHandler };
