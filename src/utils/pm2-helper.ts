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
  | 'not-found';

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

function pm2Restart(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.restart(name, (err) => (err ? reject(err) : resolve()));
  });
}
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
      projectType: 'nextjs' | 'nestjs',

    name: string;
    port: number;
    status: Status;
  }
): pm2.StartOptions => {
  const { port, status,projectType, ...rest } = config;
  
  const baseConfig: pm2.StartOptions = {
    ...rest,
    exec_mode: "cluster",
    cwd: dir,
    max_memory_restart: "250M",
    env: {
      NODE_ENV: 'production',
      PORT: port.toString(),
      ...process.env
    }
  };

  switch (projectType) {
    case 'nestjs':
      // For NestJS, run the built main.js file
      const nestjsMain = path.join(dir, 'dist', 'main.js');
      if (fs.existsSync(nestjsMain)) {
        return {
          ...baseConfig,
          script: nestjsMain,
          args: undefined
        };
      } else {
        // Fallback to npm script
        return {
          ...baseConfig,
          script: 'npm',
          args: 'run start:prod'
        };
      }
    
    case 'nextjs':
    default:
      return {
        ...baseConfig,
        script: `node_modules/next/dist/bin/next`,
        args: `start ${dir} -p ${port}`
      };
  }
};

export const runApp = async (
  dir: string,
  config: Omit<pm2.StartOptions, "exec_mode" | "script" | "args"> & {
    name: string;
    port: number;
    status: Status;
    projectType: 'nextjs' | 'nestjs';
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
      await pm2Restart(config.name);
      Logger.info(`"${config.name}" restarted successfully.`);
    }
  } finally {
    pm2Disconnect();
  }
};
export const stopApp = async(name: string) => {
  await pm2Connect();
  await pm2Stop(name);
  pm2Disconnect();
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
        