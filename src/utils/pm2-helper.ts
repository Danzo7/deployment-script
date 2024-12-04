import pm2, { ProcessDescription } from "pm2";
import { Logger } from "./logger.js";
import path from "path";

export const runApp = async (dir: string,config: Omit<pm2.StartOptions,"exec_mode"|"script"|"args">&{name:string,port:number}) => {
    return new Promise<void>((resolve, reject) => {
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
  
          const existingApp = processList.find((app) => app.name === config.name);
  
          if (existingApp) {
            // If the app is found, restart it
            pm2.restart(config.name, (restartErr) => {
              pm2.disconnect();
              if (restartErr) {
                return reject(restartErr);
              }
  
              Logger.info(`PM2 process "${config.name}" restarted successfully.`);
              resolve();
            });
          } else {
            // If the app is not running, start it
            pm2.start({...config,
              exec_mode: "cluster",
              script: path.join(dir, `node_modules/next/dist/bin/next`),
              args: `start -p ${config.port}`,
              max_memory_restart: "250M",
            }, (startErr) => {
              pm2.disconnect();
              if (startErr) {
                return reject(startErr);
              }
              Logger.info(`PM2 process "${config.name}" started successfully.`);
              resolve();
            });
          }
        });
      });
    });
  };
  type Status='online' | 'stopping' | 'stopped' | 'launching' | 'errored' | 'one-launch-status'|'not found';

  export const  getAppStatus=async(name:string)=>new Promise<Status>((resolve, reject) => {
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
        if(app)
          resolve(
            app.pm2_env?.status??"not found"
          )
          else resolve(
            "not found"
          );
      
  })})});