import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { Logger } from '../utils/logger.js';
import { prepare } from '../utils/npm-helper.js';
import { applyStorageSymlinks } from '../utils/file-utils.js';
import { NEST_DIR } from '../constants.js';
import { registerHandler } from './registry.js';
import type { AppTypeHandler, BuildPm2ConfigInput, PrepareReleaseOptions, CreateBuildDirInput } from './registry.js';
import { checkEnv } from '../utils/env-heper.js';

const nestjsHandler: AppTypeHandler = {
  typeKey: 'nestjs',

  buildPm2Config(input: BuildPm2ConfigInput) {
    const { dir, name, port, config } = input;
    const nestjsMain = path.join(dir, 'dist', 'main.js');
    if (!fs.existsSync(nestjsMain)) {
      throw new Error(`NestJS main file not found at ${nestjsMain}`);
    }
    return {
      name,
      cwd: dir,
      script: nestjsMain,
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
    const envDir = path.join(appDir, 'env');
    const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;

    const distFolder = path.join(sourceRoot, 'dist');
    if (!fs.existsSync(distFolder)) {
      throw new Error('NestJS build not found. Make sure to run "npm run build" first.');
    }

    fs.mkdirSync(buildDir, { recursive: true });

    const nodeModulesSrc = path.join(sourceRoot, 'node_modules');
    if (!fs.existsSync(nodeModulesSrc)) {
      throw new Error('Node modules not found.');
    }
    Logger.info('Linking node modules...');
    fs.symlinkSync(nodeModulesSrc, path.join(buildDir, 'node_modules'));

    const envSrc = path.join(envDir, '.env');
    if (fs.existsSync(envSrc)) {
      fs.copyFileSync(envSrc, path.join(buildDir, '.env'));
    }

    const envProdSrc = path.join(envDir, '.env.production');
    if (fs.existsSync(envProdSrc)) {
      fs.copyFileSync(envProdSrc, path.join(buildDir, '.env.production'));
    }

    fsExtra.copySync(distFolder, path.join(buildDir, 'dist'));
    fsExtra.removeSync(distFolder);

    const packageJsonSrc = path.join(sourceRoot, 'package.json');
    if (fs.existsSync(packageJsonSrc)) {
      fs.copyFileSync(packageJsonSrc, path.join(buildDir, 'package.json'));
    }

    applyStorageSymlinks(buildDir, storages ?? []);
    return buildDir;
  },

  getNginxLocationDirectives(): string[] {
    return ['proxy_http_version 1.1'];
  },

  async prepareRelease(dir: string, opts: PrepareReleaseOptions): Promise<void> {
    await prepare(dir, { ...opts, withInstall: opts.withDependencies, withFix: opts.withLint });
  },

  async syncConfig(buildRelDir: string, envDir: string): Promise<boolean> {
    return checkEnv(buildRelDir, envDir, '.env');
  },

  getAppsDir(): string {
    return NEST_DIR;
  },

  getExecMode(): 'cluster' | 'fork' {
    return 'cluster';
  },

  getDisplayName(unicode: boolean): string {
    return unicode ? '🦁 NestJS' : 'NestJS';
  },

  async detect(dir: string): Promise<number> {
    let score = 0;

    // Check package.json for @nestjs/core dependency
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if ('@nestjs/core' in deps) {
          score = 90;
        }
      } catch {
        // malformed JSON — no score from this signal
      }
    }

    // Bonus for nest-cli.json presence (max 95)
    if (score > 0 && fs.existsSync(path.join(dir, 'nest-cli.json'))) {
      score = Math.min(95, score + 5);
    }

    return score;
  },
};

registerHandler(nestjsHandler);

export { nestjsHandler };
