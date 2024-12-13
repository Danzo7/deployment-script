import pm2 from 'pm2';
import { Logger } from './logger.js';
type Status =
  | 'online'
  | 'stopping'
  | 'stopped'
  | 'launching'
  | 'errored'
  | 'one-launch-status'
  | 'not-found';

export const runApp = async (
  dir: string,
  config: Omit<pm2.StartOptions, 'exec_mode' | 'script' | 'args'> & {
    name: string;
    port: number;
    status: Status;
  },
  force: boolean = false
) => {
  const {port,status,...rest}=config;
  return new Promise<void>((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        return reject(err);
      }

      if (status == 'online' && !force) {
        Logger.info(`Restarting "${config.name}"...`);
        pm2.restart(config.name, (restartErr) => {
          pm2.disconnect();
          if (restartErr) {
            return reject(restartErr);
          }

          Logger.info(`"${config.name}" restarted successfully.`);
          resolve();
        });
      } else {
    
        Logger.info(`Starting "${config.name}"...`);
        if (status == 'not-found')
          pm2.start(
            {
              ...config,
              exec_mode: 'cluster',
              cwd: dir,
              script: `node_modules/next/dist/bin/next`,
              args: `start -p ${port}`,
              max_memory_restart: '250M',
              restart_delay:100
            },
            (startErr) => {
              pm2.disconnect();
              if (startErr) {
                return reject(startErr);
              }
              Logger.info(`"${config.name}" started successfully.`);
              resolve();
            }
          );
        else {
          Logger.info(`Reinstalling "${config.name}"...`);
          pm2.delete(config.name, (deleteErr) => {
            if (deleteErr) {
              pm2.disconnect();
              return reject(deleteErr);
            }
            pm2.start(
              {
                ...rest,
                exec_mode: 'cluster',
                cwd: dir,
                script: `node_modules/next/dist/bin/next`,
                args: `start -p ${config.port}`,
                max_memory_restart: '250M',
                watch:true,
                restart_delay:100

              },
              (startErr) => {
                pm2.disconnect();
                if (startErr) {
                  return reject(startErr);
                }
                Logger.info(`"${config.name}" started successfully.`);
                resolve();
              }
            );
          });
        }
      }
    });
  });
};

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
