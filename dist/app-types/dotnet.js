import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';
import { prepareDotnet, checkDotnetInstalled, checkDotnetSdk, ensureAssemblyName, checkAppSettings } from '../utils/dotnet-helper.js';
import { applyStorageSymlinks } from '../utils/file-utils.js';
import { DOTNET_DIR } from '../constants.js';
import { registerHandler } from './registry.js';
const dotnetHandler = {
    typeKey: 'dotnet',
    buildPm2Config(input) {
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
            ...(config.minUptime ? { min_uptime: config.minUptime } : {}),
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
    createBuildDir({ appDir, projectDir, storages }) {
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
    getNginxLocationDirectives() {
        return [];
    },
    async prepareRelease(dir, opts) {
        // Validate SDK version and ensure assembly name match before building
        await checkDotnetSdk(dir);
        if (opts.appName) {
            await ensureAssemblyName(dir, opts.appName);
        }
        await prepareDotnet(dir, { logDir: opts.logDir });
    },
    async syncConfig(buildRelDir, envDir) {
        return checkAppSettings(buildRelDir, envDir);
    },
    getAppsDir() {
        return DOTNET_DIR;
    },
    getDisplayName(unicode) {
        return unicode ? '🔷 .NET' : '.NET';
    },
    checkPrerequisites() {
        checkDotnetInstalled();
    },
    getExecMode() {
        return 'fork';
    },
    supportsNodeArgs() {
        return false;
    },
    async detect(dir) {
        // Check for *.csproj files
        try {
            const entries = fs.readdirSync(dir);
            if (entries.some((f) => f.endsWith('.csproj'))) {
                return 95;
            }
        }
        catch {
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
