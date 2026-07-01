import pm2 from 'pm2';
import path from 'path';
import fs from 'fs';
import { Logger } from './logger.js';
type Status =
  | 'online'
  | 'stopping'
  | 'stopped'
  | 'launching'
  | 'errored'
  | 'one-launch-status'
  | 'not-found'| string; 

function pm2Connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
}

function pm2Disconnect(): void {
  pm2.disconnect();
}

function pm2Start(config: pm2.StartOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.start(config, (err) => (err ? reject(err) : resolve()));
  });
}

function pm2Stop(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err) => (err ? reject(err) : resolve()));
  });
}

// function pm2Restart(name: string): Promise<void> {
//   return new Promise((resolve, reject) => {
//     pm2.restart(name, (err) => (err ? reject(err) : resolve()));
//   });
// }
function pm2Delete(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err) => (err ? reject(err) : resolve()));
  });
}
/**
 * Gets the PM2 configuration based on project type
 */
const getPM2Config = (
  dir: string, 
  config: Omit<pm2.StartOptions, "exec_mode" | "script" | "args"> & {
  projectType: 'nextjs' | 'nestjs' | 'dotnet',
  name: string;
  port: number;
  status: Status;
  }
): pm2.StartOptions => {
  const { port ,projectType, ...rest } = config;
  
  const baseConfig: pm2.StartOptions = {
    ...rest,
    exec_mode: "cluster",
    cwd: dir,
    max_memory_restart: "250M",
    env: {
      NODE_ENV: 'production',
      PORT: port.toString(),
    }
  };

  switch (projectType) {
    case 'nestjs':{
        const nestjsMain = path.join(dir, 'dist', 'main.js');
      if (!fs.existsSync(nestjsMain)) throw new Error(`NestJS main file not found at ${nestjsMain}`);
        return {
          ...baseConfig,
          script: nestjsMain,
          args: undefined
        };
      }
      
    case 'dotnet': {
      const dllPath = path.join(dir, `${config.name}.dll`);
      if (!fs.existsSync(dllPath)) {
        throw new Error(`DLL not found at ${dllPath}`);
      }
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

    case 'nextjs':
    default:
      return {
        ...baseConfig,
        script: path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'),
        args: `start -p ${port}`
      };
  }
};

export const runApp = async (
  dir: string,
  config: Omit<pm2.StartOptions, "exec_mode" | "script" | "args"> & {
    name: string;
    port: number;
    status: Status;
    projectType: 'nextjs' | 'nestjs' | 'dotnet';
  }
) => {
  const pm2Config = getPM2Config(dir, config);

  try {
    await pm2Connect();

    if (config.status === "not-found") {
      Logger.info(`Starting "${config.name}" (${config.projectType})...`);
      await pm2Start(pm2Config);
      Logger.info(`"${config.name}" started successfully.`);
    } else {
      Logger.info(`Restarting "${config.name}" (${config.projectType})...`);
      await pm2Delete(config.name);
      await pm2Start(pm2Config);
      Logger.info(`"${config.name}" restarted successfully.`);
    }
  } finally {
    pm2Disconnect();
  }
};
export const stopApp = async(name: string) => {
    try {
      await pm2Connect();
      await pm2Stop(name);
    } finally {
      pm2Disconnect();
    }
}
export const getAppStatus = async (name: string) =>
  new Promise<Status>((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        return reject(err);
      }

      // Check if the app is already running
      pm2.list((listErr, processList) => {
        if (listErr) {
          pm2.disconnect();
          return reject(listErr);
        }

        const app = processList.find((app) => app.name === name);   
        if (app) resolve(app.pm2_env?.status ?? 'not-found');
        else resolve('not-found');
      });
    });
  });
  export const getProcessId = async (name: string) =>
    new Promise<number|undefined>((resolve, reject) => {
      pm2.connect((err) => {
        if (err) {
          return reject(err);
        }
  
        // Check if the app is already running
        pm2.list((listErr, processList) => {
          if (listErr) {
            pm2.disconnect();
            return reject(listErr);
          }
  
          const app = processList.find((app) => app.name === name);   
          if (app) resolve(app.pid);
          else resolve(undefined);
        });
      });
    });
export const deletePm2App = async (name: string) => {
  return new Promise<void>((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        return reject(err);
      }
        pm2.delete(name, (deleteErr) => {
          pm2.disconnect();
          if (deleteErr) {
            return reject(deleteErr);
          }
          Logger.info(`"${name}" deleted successfully.`);
          resolve();
        });
    });
  });
};

export const getProcessInfo = (name: string): Promise<{ status: string; proc: pm2.ProcessDescription | undefined }> =>
  new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      pm2.describe(name, (descErr, list) => {
        pm2.disconnect();
        if (descErr) return reject(descErr);
        const proc = list?.[0];
        const env = proc?.pm2_env as any;
        const status = env?.status ?? 'stopped';
        resolve({ status, proc });
      });
    });
  });
        

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
}

/**
 * Returns metrics for every PM2-managed process, aggregating cluster workers
 * by name (summing CPU/mem across instances).
 * Connects and disconnects automatically — caller does not need to manage the
 * PM2 daemon connection.
 */
export const listAllProcessMetrics = async (): Promise<ProcessMetrics[]> => {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      pm2.list((listErr, processList) => {
        pm2.disconnect();
        if (listErr) return reject(listErr);

        // Group cluster workers by name
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
          });
        }
        resolve(results);
      });
    });
  });
};

export interface BusPacket {
  event: 'log:out' | 'log:err' | 'process:event' | string;
  process: { name: string; pm_id?: number };
  data: any;
}

/**
 * Subscribe to the PM2 event bus.
 * Calls onPacket for every event, onError if the bus fails.
 * Returns a cleanup function — call it to close the bus and disconnect.
 *
 * Uses a single persistent PM2 connection; caller must not call pm2.disconnect()
 * independently while the bus is live.
 */
export const subscribeBus = (
  onPacket: (packet: BusPacket) => void,
  onError?: (err: Error) => void,
): Promise<() => void> => {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      pm2.launchBus((busErr, bus) => {
        if (busErr) {
          pm2.disconnect();
          return reject(busErr);
        }
        const events = ['log:out', 'log:err', 'process:event'];
        for (const ev of events) {
          bus.on(ev, (packet: any) => onPacket({ ...packet, event: ev }));
        }
        bus.on('error', (e: any) => onError?.(e instanceof Error ? e : new Error(String(e))));

        const cleanup = () => {
          try { bus.close(); } catch { /* ignore */ }
          try { pm2.disconnect(); } catch { /* ignore */ }
        };
        resolve(cleanup);
      });
    });
  });
};
