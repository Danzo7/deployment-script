import path from "path";
import { AppRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import fs, { createWriteStream } from "fs";
import { checkEnv, ensureDirectories } from "../utils/file-utils.js";
import { prepare } from "../utils/npm-helper.js";
import { getAppStatus, runApp } from "../utils/pm2-helper.js";
import { handleGitRepo } from "../utils/git-helper.js";
export const saveLogs=(logDir:string)=>{
  const stdoutLogStream = createWriteStream(path.join(logDir, "deploy.log"), {
        flags: "w",
      });
      process.stdout.write = (chunk: any) => {
        stdoutLogStream.write(chunk);
        return true;
      };
      process.stderr.write = (chunk: any) => {
        stdoutLogStream.write(chunk);
        return true;
      };
}
export const deploy = async ({name,force,lint}:{name:string,lint?:boolean,force?:boolean}) => {
      let app=AppRepo.getAll().find((app)=>app.name===name);
      const isFirstDeploy=app?.lastDeploy==undefined;
  if(!app){
    throw new Error("App not found");}
   const {relDir,envDir,logDir}=ensureDirectories(app.appDir); 
   saveLogs(logDir);
  Logger.info("Checking Git repository...")
  let isGitChanged=await handleGitRepo({dir:relDir,repo:app.repo,branch:app.branch});

  Logger.info("Checking app status...");
  const appStatus=await getAppStatus(name);
  Logger.advice(`App Status: ${appStatus}`);
  let isRunning=appStatus=="online";

  Logger.info("Checking environment...");
    let isEnvChanged=await checkEnv(relDir,envDir);
    if(isEnvChanged&&!isGitChanged&&!isFirstDeploy){ 
     Logger.success(`Everything is up to date`);
    if(isRunning){
      Logger.info(`${name} is already running on port ${app.port}`);
      if(force){Logger.info("Forcing restart...");} else
      return;
    }
    }
  
  await prepare(relDir,{
    withInstall:force||isFirstDeploy|| isGitChanged||!isRunning,
    withBuild:force||!isRunning||isFirstDeploy||isGitChanged||!isEnvChanged,
    withFix:force||lint// Add skip lint in future
  });
  await runApp(relDir,{name:app.name,port:app.port,instances:app.instances,status:appStatus,
    output:path.join(logDir,"pm2.out.log"), error:path.join(logDir,"pm2.error.log") 
  });
  AppRepo.updateLastDeploy(name);
  Logger.success(`Successfully deployed ${name} on port ${app.port}`);
  
    };