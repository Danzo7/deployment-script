import pm2 from 'pm2';
import fs from 'fs';
import { Logger } from './logger.js';
import { getHandler } from '../app-types/index.js';
// ─── Connection management ────────────────────────────────────────────────────
//
// withPm2(op) is the single entry point for all PM2 operations.
//
// Uses a reference-counted connection:
//   - First caller connects; subsequent concurrent callers reuse the live connection.
//   - Disconnect only fires when the last in-flight operation finishes.
//   - openSharedPm2/closeSharedPm2 pin the connection open (e.g. for the dashboard).
//
// This prevents rapid connect/disconnect races that cause PM2 client null crashes.
let _refCount = 0;
let _connected = false;
let _connecting = null;
let _sharedConnected = false;
let _disconnectTimer = null;
function _connect() {
    // Cancel any pending deferred disconnect — we're back in use
    if (_disconnectTimer) {
        clearTimeout(_disconnectTimer);
        _disconnectTimer = null;
    }
    if (_connected)
        return Promise.resolve();
    if (_connecting)
        return _connecting;
    _connecting = new Promise((resolve, reject) => {
        pm2.connect((err) => {
            _connecting = null;
            if (err)
                return reject(err);
            _connected = true;
            resolve();
        });
    });
    return _connecting;
}
function _release() {
    _refCount--;
    if (_refCount <= 0 && !_sharedConnected) {
        _refCount = 0;
        // Debounce the disconnect so sequential bursts reuse the live connection
        // instead of thrashing connect/disconnect between each call
        if (_disconnectTimer)
            clearTimeout(_disconnectTimer);
        _disconnectTimer = setTimeout(() => {
            _disconnectTimer = null;
            if (_refCount <= 0 && !_sharedConnected) {
                _connected = false;
                try {
                    pm2.disconnect();
                }
                catch {
                    /* ignore */
                }
            }
        }, 75);
    }
}
/** Open a persistent PM2 connection. Call once before the dashboard renders. */
export async function openSharedPm2() {
    _sharedConnected = true;
    // Cancel any pending deferred disconnect before we reconnect
    if (_disconnectTimer) {
        clearTimeout(_disconnectTimer);
        _disconnectTimer = null;
    }
    await _connect();
}
/** Close the persistent PM2 connection. Call after the dashboard has fully exited. */
export function closeSharedPm2() {
    if (!_sharedConnected)
        return;
    _sharedConnected = false;
    if (_refCount <= 0) {
        if (_disconnectTimer) {
            clearTimeout(_disconnectTimer);
            _disconnectTimer = null;
        }
        _connected = false;
        try {
            pm2.disconnect();
        }
        catch {
            /* ignore */
        }
    }
}
async function withPm2(op) {
    // Increment BEFORE the await so no concurrent _release() can drop
    // _refCount to 0 and disconnect while this call is still pending connect.
    _refCount++;
    try {
        await _connect();
        return await op();
    }
    finally {
        _release();
    }
}
// ─── Low-level wrappers ───────────────────────────────────────────────────────
function _pm2Start(config) {
    return new Promise((resolve, reject) => {
        pm2.start(config, (err) => (err ? reject(err) : resolve()));
    });
}
function _pm2Stop(name) {
    return new Promise((resolve, reject) => {
        pm2.stop(name, (err) => (err ? reject(err) : resolve()));
    });
}
function _pm2Delete(name) {
    return new Promise((resolve, reject) => {
        pm2.delete(name, (err) => (err ? reject(err) : resolve()));
    });
}
function _pm2Flush(name) {
    return new Promise((resolve, reject) => {
        pm2.flush(name, (err) => (err ? reject(err) : resolve()));
    });
}
// ─── PM2 config builder ───────────────────────────────────────────────────────
const getPM2Config = (dir, config) => {
    const { port, projectType, name, status, config: appConfig } = config;
    const handler = getHandler(projectType);
    const pm2Config = handler.buildPm2Config({ dir, name, port, status, config: appConfig });
    return { ...pm2Config, exec_mode: handler.getExecMode() };
};
// ─── Public API ───────────────────────────────────────────────────────────────
export const runApp = async (dir, config) => {
    const pm2Config = getPM2Config(dir, config);
    await withPm2(async () => {
        if (config.status === 'not-found') {
            Logger.info(`Starting "${config.name}" (${config.projectType})...`);
            await _pm2Start(pm2Config);
            Logger.info(`"${config.name}" started successfully.`);
        }
        else {
            Logger.info(`Restarting "${config.name}" (${config.projectType})...`);
            await _pm2Delete(config.name);
            await _pm2Start(pm2Config);
            Logger.info(`"${config.name}" restarted successfully.`);
        }
    });
};
export const stopApp = async (name) => withPm2(() => _pm2Stop(name));
export const flushApp = async (name) => withPm2(() => _pm2Flush(name));
export const deletePm2App = async (name) => withPm2(() => new Promise((resolve, reject) => {
    pm2.delete(name, (err) => {
        if (err)
            return reject(err);
        Logger.info(`"${name}" deleted successfully.`);
        resolve();
    });
}));
export const getAppStatus = (name) => withPm2(() => new Promise((resolve, reject) => {
    pm2.list((err, list) => {
        if (err)
            return reject(err);
        const proc = list.find((p) => p.name === name);
        resolve(proc ? (proc.pm2_env?.status ?? 'not-found') : 'not-found');
    });
}));
/**
 * Get status for multiple apps in a single PM2 query
 * Returns a Map of app name -> status for efficient lookup
 */
export const getAllAppStatuses = () => withPm2(() => new Promise((resolve, reject) => {
    pm2.list((err, list) => {
        if (err)
            return reject(err);
        const statusMap = new Map();
        for (const proc of list) {
            if (proc.name) {
                statusMap.set(proc.name, proc.pm2_env?.status ?? 'not-found');
            }
        }
        resolve(statusMap);
    });
}));
export const getProcessId = (name) => withPm2(() => new Promise((resolve, reject) => {
    pm2.list((err, list) => {
        if (err)
            return reject(err);
        resolve(list.find((p) => p.name === name)?.pid);
    });
}));
export const getProcessInfo = (name) => withPm2(() => new Promise((resolve, reject) => {
    pm2.describe(name, (err, list) => {
        if (err)
            return reject(err);
        const proc = list?.[0];
        resolve({
            status: proc?.pm2_env?.status ?? 'stopped',
            proc,
        });
    });
}));
function buildMetrics(processList) {
    const byName = new Map();
    for (const p of processList) {
        const n = p.name ?? '';
        if (!byName.has(n))
            byName.set(n, []);
        byName.get(n).push(p);
    }
    const results = [];
    for (const [name, procs] of byName) {
        const first = procs[0];
        const env = first.pm2_env;
        let cpu = 0;
        let memBytes = 0;
        for (const p of procs) {
            cpu += p.monit?.cpu ?? 0;
            memBytes += p.monit?.memory ?? 0;
        }
        results.push({
            name,
            status: env?.status ?? 'unknown',
            cpu,
            memBytes,
            uptimeMs: env?.pm_uptime ? Date.now() - env.pm_uptime : 0,
            restarts: env?.restart_time ?? 0,
            unstableRestarts: env?.unstable_restarts ?? 0,
            execMode: env?.exec_mode ?? 'fork',
            instances: procs.length,
            pid: first.pid ?? undefined,
            execPath: env?.pm_exec_path ?? undefined,
            scriptPath: env?.pm_exec_path ?? undefined,
        });
    }
    return results;
}
export const listAllProcessMetrics = () => withPm2(() => new Promise((resolve, reject) => {
    pm2.list((err, list) => {
        if (err)
            return reject(err);
        resolve(buildMetrics(list));
    });
}));
/**
 * Subscribe to the PM2 event bus.
 * Requires openSharedPm2() to have been called first.
 * Returns a cleanup fn that closes the bus without disconnecting.
 */
export const subscribeBus = (onPacket, onError) => new Promise((resolve, reject) => {
    pm2.launchBus((err, bus) => {
        if (err)
            return reject(err);
        for (const ev of ['log:out', 'log:err', 'process:event']) {
            bus.on(ev, (packet) => onPacket({ ...packet, event: ev }));
        }
        bus.on('error', (e) => onError?.(e instanceof Error ? e : new Error(String(e))));
        resolve(() => {
            try {
                bus.close();
            }
            catch {
                /* ignore */
            }
        });
    });
});
// ─── Log file reader ──────────────────────────────────────────────────────────
/**
 * Reads the last `maxLines` lines from each PM2 process's log files.
 * Returns formatted strings in the same style as bus packets.
 * Uses the shared connection when open.
 */
export const readRecentLogs = (maxLines = 300) => withPm2(() => new Promise((resolve) => {
    pm2.list((err, processList) => {
        if (err || !processList)
            return resolve([]);
        const results = [];
        for (const proc of processList) {
            const env = proc.pm2_env;
            const name = proc.name ?? 'unknown';
            for (const [logKey, tag] of [
                ['pm_out_log_path', ''],
                ['pm_err_log_path', '[err]'],
            ]) {
                const logPath = env?.[logKey];
                if (!logPath)
                    continue;
                try {
                    if (!fs.existsSync(logPath))
                        continue;
                    const lines = fs
                        .readFileSync(logPath, 'utf8')
                        .split('\n')
                        .filter(Boolean);
                    for (const line of lines.slice(-maxLines)) {
                        results.push(`[${name}] ${tag ? tag + ' ' : ''}${line.trim()}`);
                    }
                }
                catch {
                    /* skip unreadable files */
                }
            }
        }
        resolve(results);
    });
}));
/**
 * Reads the last `maxLines` lines from a single app's PM2 log files.
 * Returns formatted strings with `[appName]` and `[appName][err]` prefixes.
 */
export const readAppLogs = (appName, maxLines = 300) => withPm2(() => new Promise((resolve) => {
    pm2.list((err, processList) => {
        if (err || !processList)
            return resolve([]);
        const proc = processList.find((p) => p.name === appName);
        if (!proc)
            return resolve([]);
        const env = proc.pm2_env;
        const results = [];
        for (const [logKey, tag] of [
            ['pm_out_log_path', ''],
            ['pm_err_log_path', '[err]'],
        ]) {
            const logPath = env?.[logKey];
            if (!logPath)
                continue;
            try {
                if (!fs.existsSync(logPath))
                    continue;
                const lines = fs
                    .readFileSync(logPath, 'utf8')
                    .split('\n')
                    .filter(Boolean);
                for (const line of lines.slice(-maxLines)) {
                    results.push(`[${appName}]${tag ? '[err]' : ''} ${line.trim()}`);
                }
            }
            catch {
                /* skip unreadable */
            }
        }
        resolve(results);
    });
}));
