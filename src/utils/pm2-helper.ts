import pm2 from 'pm2';
import path from 'path';
import fs from 'fs';
import { Logger } from './logger.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const _dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_SERVER_SCRIPT = resolve(_dirname, '..', 'static-server', 'serve.js');

type Status =
  | 'online'
  | 'stopping'
  | 'stopped'
  | 'launching'
  | 'errored'
  | 'one-launch-status'
  | 'not-found'
  | string;

// ─── Connection management ────────────────────────────────────────────────────
//
// withPm2(op) is the single entry point for all PM2 operations.
//   - When the dashboard is running (shared connection open): runs op() directly.
//   - Otherwise: opens a transient connection, runs op(), then disconnects.
//
// This guarantees nothing disconnects PM2 while the dashboard is live.

let _sharedConnected = false;

/** Open a persistent PM2 connection. Call once before the dashboard renders. */
export function openSharedPm2(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (_sharedConnected) return resolve();
    pm2.connect((err) => {
      if (err) return reject(err);
      _sharedConnected = true;
      resolve();
    });
  });
}

/** Close the persistent PM2 connection. Call after the dashboard has fully exited. */
export function closeSharedPm2(): void {
  if (!_sharedConnected) return;
  _sharedConnected = false;
  try { pm2.disconnect(); } catch { /* ignore */ }
}

async function withPm2<T>(op: () => Promise<T>): Promise<T> {
  if (_sharedConnected) return op();
  return new Promise<T>((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      op().then(resolve, reject).finally(() => {
        try { pm2.disconnect(); } catch { /* ignore */ }
      });
    });
  });
}

// ─── Low-level wrappers ───────────────────────────────────────────────────────

function _pm2Start(config: pm2.StartOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.start(config, (err) => (err ? reject(err) : resolve()));
  });
}

function _pm2Stop(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err) => (err ? reject(err) : resolve()));
  });
}

function _pm2Delete(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err) => (err ? reject(err) : resolve()));
  });
}

// ─── PM2 config builder ───────────────────────────────────────────────────────

const getPM2Config = (
  dir: string,
  config: Omit<pm2.StartOptions, 'exec_mode' | 'script' | 'args'> & {
    projectType: 'nextjs' | 'nestjs' | 'dotnet' | 'static';
    name: string;
    port: number;
    status: Status;
  },
): pm2.StartOptions => {
  const { port, projectType, ...rest } = config;

  const baseConfig: pm2.StartOptions = {
    ...rest,
    exec_mode: 'cluster',
    cwd: dir,
    max_memory_restart: '250M',
    env: {
      NODE_ENV: 'production',
      PORT: port.toString(),
    },
  };

  switch (projectType) {
    case 'nestjs': {
      const nestjsMain = path.join(dir, 'dist', 'main.js');
      if (!fs.existsSync(nestjsMain)) throw new Error(`NestJS main file not found at ${nestjsMain}`);
      return { ...baseConfig, script: nestjsMain, args: undefined };
    }

    case 'dotnet': {
      const dllPath = path.join(dir, `${config.name}.dll`);
      if (!fs.existsSync(dllPath)) throw new Error(`DLL not found at ${dllPath}`);
      return {
        ...rest,
        exec_mode: 'fork',
        cwd: dir,
        max_memory_restart: '250M',
        script: 'dotnet',
        args: dllPath,
        env: {
          ASPNETCORE_ENVIRONMENT: 'Production',
          ASPNETCORE_URLS: `http://0.0.0.0:${port}`,
        },
      };
    }

    case 'static':
      return { ...baseConfig, exec_mode: 'fork', script: STATIC_SERVER_SCRIPT, args: undefined };

    case 'nextjs':
    default:
      return {
        ...baseConfig,
        script: path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'),
        args: `start -p ${port}`,
      };
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const runApp = async (
  dir: string,
  config: Omit<pm2.StartOptions, 'exec_mode' | 'script' | 'args'> & {
    name: string;
    port: number;
    status: Status;
    projectType: 'nextjs' | 'nestjs' | 'dotnet' | 'static';
  },
): Promise<void> => {
  const pm2Config = getPM2Config(dir, config);
  await withPm2(async () => {
    if (config.status === 'not-found') {
      Logger.info(`Starting "${config.name}" (${config.projectType})...`);
      await _pm2Start(pm2Config);
      Logger.info(`"${config.name}" started successfully.`);
    } else {
      Logger.info(`Restarting "${config.name}" (${config.projectType})...`);
      await _pm2Delete(config.name);
      await _pm2Start(pm2Config);
      Logger.info(`"${config.name}" restarted successfully.`);
    }
  });
};

export const stopApp = async (name: string): Promise<void> =>
  withPm2(() => _pm2Stop(name));

export const deletePm2App = async (name: string): Promise<void> =>
  withPm2(() => new Promise<void>((resolve, reject) => {
    pm2.delete(name, (err) => {
      if (err) return reject(err);
      Logger.info(`"${name}" deleted successfully.`);
      resolve();
    });
  }));

export const getAppStatus = (name: string): Promise<Status> =>
  withPm2(() => new Promise<Status>((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      const proc = list.find((p) => p.name === name);
      resolve(proc ? (proc.pm2_env?.status ?? 'not-found') : 'not-found');
    });
  }));

export const getProcessId = (name: string): Promise<number | undefined> =>
  withPm2(() => new Promise<number | undefined>((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      resolve(list.find((p) => p.name === name)?.pid);
    });
  }));

export const getProcessInfo = (name: string): Promise<{ status: string; proc: pm2.ProcessDescription | undefined }> =>
  withPm2(() => new Promise((resolve, reject) => {
    pm2.describe(name, (err, list) => {
      if (err) return reject(err);
      const proc = list?.[0];
      resolve({ status: (proc?.pm2_env as any)?.status ?? 'stopped', proc });
    });
  }));

// ─── Process metrics ──────────────────────────────────────────────────────────

export interface ProcessMetrics {
  name: string;
  status: Status;
  cpu: number;
  memBytes: number;
  uptimeMs: number;
  restarts: number;
  unstableRestarts: number;
  execMode: string;
  instances: number;
  pid?: number;
  execPath?: string;
  scriptPath?: string;
}

function buildMetrics(processList: pm2.ProcessDescription[]): ProcessMetrics[] {
  const byName = new Map<string, pm2.ProcessDescription[]>();
  for (const p of processList) {
    const n = p.name ?? '';
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n)!.push(p);
  }
  const results: ProcessMetrics[] = [];
  for (const [name, procs] of byName) {
    const first = procs[0];
    const env = first.pm2_env as any;
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

export const listAllProcessMetrics = (): Promise<ProcessMetrics[]> =>
  withPm2(() => new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      resolve(buildMetrics(list));
    });
  }));

// ─── Bus subscription ─────────────────────────────────────────────────────────

export interface BusPacket {
  event: 'log:out' | 'log:err' | 'process:event' | string;
  process: { name: string; pm_id?: number };
  data: any;
}

/**
 * Subscribe to the PM2 event bus.
 * Requires openSharedPm2() to have been called first.
 * Returns a cleanup fn that closes the bus without disconnecting.
 */
export const subscribeBus = (
  onPacket: (packet: BusPacket) => void,
  onError?: (err: Error) => void,
): Promise<() => void> =>
  new Promise((resolve, reject) => {
    pm2.launchBus((err, bus) => {
      if (err) return reject(err);
      for (const ev of ['log:out', 'log:err', 'process:event']) {
        bus.on(ev, (packet: any) => onPacket({ ...packet, event: ev }));
      }
      bus.on('error', (e: any) => onError?.(e instanceof Error ? e : new Error(String(e))));
      resolve(() => { try { bus.close(); } catch { /* ignore */ } });
    });
  });

// ─── Log file reader ──────────────────────────────────────────────────────────

/**
 * Reads the last `maxLines` lines from each PM2 process's log files.
 * Returns formatted strings in the same style as bus packets.
 * Uses the shared connection when open.
 */
export const readRecentLogs = (maxLines = 300): Promise<string[]> =>
  withPm2(() => new Promise((resolve) => {
    pm2.list((err, processList) => {
      if (err || !processList) return resolve([]);
      const results: string[] = [];
      for (const proc of processList) {
        const env = proc.pm2_env as any;
        const name = proc.name ?? 'unknown';
        for (const [logKey, tag] of [
          ['pm_out_log_path', ''],
          ['pm_err_log_path', '[err]'],
        ] as const) {
          const logPath: string | undefined = env?.[logKey];
          if (!logPath) continue;
          try {
            if (!fs.existsSync(logPath)) continue;
            const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
            for (const line of lines.slice(-maxLines)) {
              results.push(`[${name}] ${tag ? tag + ' ' : ''}${line.trim()}`);
            }
          } catch { /* skip unreadable files */ }
        }
      }
      resolve(results);
    });
  }));

/**
 * Reads the last `maxLines` lines from a single app's PM2 log files.
 * Returns formatted strings with `[appName]` and `[appName][err]` prefixes.
 */
export const readAppLogs = (appName: string, maxLines = 300): Promise<string[]> =>
  withPm2(() => new Promise((resolve) => {
    pm2.list((err, processList) => {
      if (err || !processList) return resolve([]);
      const proc = processList.find((p) => p.name === appName);
      if (!proc) return resolve([]);
      const env = proc.pm2_env as any;
      const results: string[] = [];
      for (const [logKey, tag] of [
        ['pm_out_log_path', ''],
        ['pm_err_log_path', '[err]'],
      ] as const) {
        const logPath: string | undefined = env?.[logKey];
        if (!logPath) continue;
        try {
          if (!fs.existsSync(logPath)) continue;
          const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
          for (const line of lines.slice(-maxLines)) {
            results.push(`[${appName}]${tag ? '[err]' : ''} ${line.trim()}`);
          }
        } catch { /* skip unreadable */ }
      }
      resolve(results);
    });
  }));
