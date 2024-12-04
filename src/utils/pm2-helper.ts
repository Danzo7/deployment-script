import pm2, { ProcessDescription } from "pm2";
import { Logger } from "./logger.js";
import path from "path";
type Status='online' | 'stopping' | 'stopped' | 'launching' | 'errored' | 'one-launch-status'|'not-found';

export const runApp = async (dir: string,config: Omit<pm2.StartOptions,"exec_mode"|"script"|"args">&{name:string,port:number,status:Status}) => {
    return new Promise<void>((resolve, reject) => {
      pm2.connect((err) => {
        if (err) {
          return reject(err);
        }
  
        if (config.status=="online") {
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
          // If the app is not found, start it
          if(config.status=="not-found")
          pm2.start({...config,
            exec_mode: "cluster",
            cwd:dir,  
            script: `node_modules/next/dist/bin/next`,
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
          else{
            pm2.delete(config.name, (deleteErr) => {
                if(deleteErr){
                  pm2.disconnect();  
                  return reject(deleteErr);   
                } 
                pm2.start({...config,
                  exec_mode: "cluster",
                  cwd:dir,  
                  script: `node_modules/next/dist/bin/next`,
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
            })
          }
        }
      });
    });
  };

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
            app.pm2_env?.status??"not-found"
          )
          else resolve(
            "not-found"
          );
      
  })})});