/**
 * Utility functions for domain push operations
 */
import fs from 'fs';
import { validateSafeDomainName } from './security-validation.js';
/**
 * Capture a file snapshot for local files
 * @param filePath - The file path to snapshot
 * @returns FileSnapshot containing the current state
 */
export function captureFileSnapshot(filePath) {
    try {
        const stats = fs.lstatSync(filePath);
        const isSymlink = stats.isSymbolicLink();
        if (isSymlink) {
            const target = fs.readlinkSync(filePath);
            return {
                path: filePath,
                existed: true,
                isSymlink: true,
                target,
            };
        }
        else {
            const content = fs.readFileSync(filePath);
            return {
                path: filePath,
                existed: true,
                content,
            };
        }
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return {
                path: filePath,
                existed: false,
            };
        }
        throw err;
    }
}
/**
 * Normalize domain filename by replacing dots with underscores
 * @param domainName - The domain name (e.g., "api.example.com")
 * @returns The normalized filename (e.g., "api_example_com")
 */
export function normalizeDomainFilename(domainName) {
    // Validate domain name for security before normalization
    validateSafeDomainName(domainName);
    return domainName.replace(/\./g, '_');
}
/**
 * Construct the sites-available path for a domain config
 * @param domainName - The domain name
 * @returns The full path (e.g., "/etc/nginx/sites-available/api_example_com.conf")
 */
export function constructSitesAvailablePath(domainName) {
    const filename = normalizeDomainFilename(domainName);
    return `/etc/nginx/sites-available/${filename}.conf`;
}
/**
 * Construct the sites-enabled path for a domain config symlink
 * @param domainName - The domain name
 * @returns The full path (e.g., "/etc/nginx/sites-enabled/api_example_com.conf")
 */
export function constructSitesEnabledPath(domainName) {
    const filename = normalizeDomainFilename(domainName);
    return `/etc/nginx/sites-enabled/${filename}.conf`;
}
/**
 * Safely single-quote a value for interpolation into a POSIX shell command.
 * Wraps the value in single quotes and escapes any embedded single quotes,
 * which is the standard safe-quoting technique for sh/bash.
 *
 * Always use this (never raw template interpolation) when a path, domain
 * name, or any other externally-influenced value is placed into a shell
 * command string sent over SSH or to execSync/exec.
 *
 * @param value - The raw value to quote
 * @returns A shell-safe, single-quoted string including the surrounding quotes
 */
export function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
/**
 * Build the ordered list of rollback targets for a push snapshot.
 * Centralizes "which files did we touch and in what order should they be
 * rolled back" so local and remote pushers don't each hand-roll the list.
 *
 * Order matters: symlink first (so nginx never momentarily points at a
 * half-restored config), then the config file, then certs.
 */
export function buildRollbackTargets(snapshot, paths) {
    const targets = [
        { label: 'symlink', path: paths.symlinkPath, snapshot: snapshot.symlink },
        {
            label: 'config file',
            path: paths.configPath,
            snapshot: snapshot.configFile,
        },
    ];
    if (snapshot.certs && paths.certPath && paths.keyPath) {
        targets.push({
            label: 'certificate',
            path: paths.certPath,
            snapshot: snapshot.certs.cert,
        }, {
            label: 'private key',
            path: paths.keyPath,
            snapshot: snapshot.certs.key,
        });
    }
    return targets;
}
