import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { Logger } from '../utils/logger.js';
import { prepare } from '../utils/npm-helper.js';
import { applyStorageSymlinks } from '../utils/file-utils.js';
import { NEXT_DIR } from '../constants.js';
import { registerHandler } from './registry.js';
import { checkEnv } from '../utils/env-heper.js';
const nextjsHandler = {
    typeKey: 'nextjs',
    buildPm2Config(input) {
        const { dir, name, port, config } = input;
        return {
            name,
            cwd: dir,
            script: path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'),
            args: `start -p ${port}`,
            instances: config.instances,
            max_memory_restart: config.maxMemory,
            ...(config.autorestart !== null && config.autorestart !== undefined ? { autorestart: config.autorestart } : {}),
            ...(config.maxRestarts !== null && config.maxRestarts !== undefined ? { max_restarts: config.maxRestarts } : {}),
            ...(config.minUptime ? { min_uptime: config.minUptime } : {}),
            ...(config.restartDelay !== null && config.restartDelay !== undefined ? { restart_delay: config.restartDelay } : {}),
            ...(config.killTimeout !== null && config.killTimeout !== undefined ? { kill_timeout: config.killTimeout } : {}),
            ...(config.nodeArgs ? { node_args: config.nodeArgs } : {}),
            env: { NODE_ENV: 'production', PORT: port.toString() },
        };
    },
    createBuildDir({ appDir, projectDir, storages }) {
        const buildDir = path.join(appDir, 'builds', 'build-' + Date.now());
        const releaseDir = path.join(appDir, 'release');
        const envDir = path.join(appDir, 'env');
        const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;
        const nextConfigExts = ['.mjs', '.js', '.ts', '.cjs', '.json'];
        const nextFolder = path.join(sourceRoot, '.next');
        const publicFolder = path.join(sourceRoot, 'public');
        const contentFolder = path.join(sourceRoot, 'content');
        if (fs.existsSync(publicFolder))
            fsExtra.copySync(publicFolder, path.join(buildDir, 'public'));
        if (fs.existsSync(contentFolder)) {
            Logger.info('Content folder found and being preserved...');
            fsExtra.copySync(contentFolder, path.join(buildDir, 'content'));
        }
        if (!fs.existsSync(nextFolder))
            throw new Error('Next.js build not found.');
        fs.mkdirSync(buildDir, { recursive: true });
        const nodeModulesSrc = path.join(sourceRoot, 'node_modules');
        if (!fs.existsSync(nodeModulesSrc))
            throw new Error('Node modules not found.');
        Logger.info('Linking node modules...');
        fs.symlinkSync(nodeModulesSrc, path.join(buildDir, 'node_modules'));
        const envLocalSrc = path.join(envDir, '.env.local');
        if (fs.existsSync(envLocalSrc))
            fs.copyFileSync(envLocalSrc, path.join(buildDir, '.env.local'));
        Logger.info('Linking .next folder...');
        fsExtra.copySync(nextFolder, path.join(buildDir, '.next'));
        fsExtra.removeSync(nextFolder);
        for (const ext of nextConfigExts) {
            const src = path.join(sourceRoot, 'next.config' + ext);
            if (fs.existsSync(src))
                fs.copyFileSync(src, path.join(buildDir, 'next.config' + ext));
        }
        applyStorageSymlinks(buildDir, storages ?? []);
        return buildDir;
    },
    getNginxLocationDirectives() {
        return [
            'proxy_http_version 1.1',
            'proxy_set_header Upgrade $http_upgrade',
            'proxy_set_header Connection "upgrade"',
            'proxy_buffering off',
        ];
    },
    async prepareRelease(dir, opts) {
        await prepare(dir, { ...opts, withInstall: opts.withDependencies, withFix: opts.withLint });
    },
    async syncConfig(buildRelDir, envDir) {
        return checkEnv(buildRelDir, envDir, '.env.local');
    },
    getAppsDir() {
        return NEXT_DIR;
    },
    getExecMode() {
        return 'cluster';
    },
    getDisplayName(unicode) {
        return unicode ? '⚡ Next.js' : 'Next.js';
    },
    async detect(dir) {
        for (const ext of ['.js', '.mjs', '.ts', '.cjs']) {
            if (fs.existsSync(path.join(dir, `next.config${ext}`)))
                return 95;
        }
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
                if ('next' in deps)
                    return 80;
            }
            catch { /* malformed JSON */ }
        }
        return 0;
    },
};
registerHandler(nextjsHandler);
export { nextjsHandler };
