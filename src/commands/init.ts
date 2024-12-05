import { AppRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import fs from "fs";
import { findAvailablePort } from "../utils/network-utils.js";
import path from "path";
import { ensureDirectories } from "../utils/file-utils.js";

export const init = async ({name,repo,branch,instances,port,appsDir}:{name:string;repo:string,branch:string,instances?:number,port?:number,appsDir:string}) => {  
  if(!repo) throw new Error("Repo is required");
    let app=AppRepo.getAll().find((app)=>app.name===name);
    if(app){
      throw new Error("App already exists");  
    }
  
      const appDir = path.join(appsDir, name);
  
      ensureDirectories(appDir);  
  
        if(!port){
          Logger.info("Port is not specified. Finding available port...");
          port=await findAvailablePort(AppRepo.getAll().map((app) => app.port));
        }
          Logger.info(`Adding app ${name}...`);
          app=AppRepo.add({
            port,repo,branch,instances,name,appDir
          });
          Logger.success(`App ${name} added successfully.`);
         Logger.advice("Run 'deploy' to start the app.");  
        
      
    }