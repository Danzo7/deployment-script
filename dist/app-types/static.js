import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Logger } from '../utils/logger.js';
import { applyStorageSymlinks } from '../utils/file-utils.js';
import { STATIC_DIR } from '../constants.js';
import { registerHandler } from './registry.js';
const _dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_SERVER_SCRIPT = resolve(_dirname, '..', 'static-server', 'serve.js');
const staticHandler = {
    typeKey: 'static',
    buildPm2Config(input) {
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
            ...(config.minUptime ? { min_uptime: config.minUptime } : {}),
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
    createBuildDir({ appDir, projectDir, storages }) {
        const buildDir = path.join(appDir, 'builds', 'build-' + Date.now());
        const releaseDir = path.join(appDir, 'release');
        const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;
        const distFolder = path.join(sourceRoot, 'dist');
        const buildFolder = path.join(sourceRoot, 'build');
        let staticSource;
        if (fs.existsSync(distFolder)) {
            staticSource = distFolder;
        }
        else if (fs.existsSync(buildFolder)) {
            staticSource = buildFolder;
        }
        if (!staticSource) {
            throw new Error(`No static output folder found for static app.\n` +
                `Expected a "dist/" or "build/" folder inside ${sourceRoot}.\n` +
                `Make sure your site is built before deploying (e.g. run "npm run build" locally and commit the output, or use a CI step that produces dist/ or build/).`);
        }
        fs.mkdirSync(buildDir, { recursive: true });
        fsExtra.copySync(staticSource, buildDir);
        Logger.info(`Copied static output from "${path.basename(staticSource)}/" into build directory.`);
        applyStorageSymlinks(buildDir, storages ?? []);
        return buildDir;
    },
    getNginxLocationDirectives() {
        return [];
    },
    async prepareRelease(dir, opts) {
        void opts; // opts not used for static apps — no build step
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            throw new Error('Static apps must have their output pre-built and committed.\n' +
                'Please build your project locally (e.g. "npm run build") and commit the dist/ or build/ folder to the repository.\n' +
                'dm does not run build steps for static apps.');
        }
        // No package.json — nothing to do
    },
    getAppsDir() {
        return STATIC_DIR;
    },
    getExecMode() {
        return 'cluster';
    },
    getDisplayName(unicode) {
        return unicode ? '📄 Static' : 'Static';
    },
    async syncConfig(_buildRelDir, _envDir) {
        void _buildRelDir;
        void _envDir;
        return false;
    },
    async detect(dir) {
        // Look for an index.html inside dist/ or build/ — that's our signal for a static site
        const candidates = ['dist', 'build'];
        for (const folder of candidates) {
            const folderPath = path.join(dir, folder);
            if (fs.existsSync(folderPath) &&
                fs.statSync(folderPath).isDirectory() &&
                fs.existsSync(path.join(folderPath, 'index.html'))) {
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
