import path from "path";
import { AppRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import fs from "fs";
import { CheckRepoActions, simpleGit } from "simple-git";
import { checkEnv, isDirectoryEmpty } from "../utils/file-utils.js";
import { prepare } from "../utils/npm-helper.js";
import { getAppStatus, runApp } from "../utils/pm2-helper.js";

export const deploy = async ({name}:{name:string}) => {
      let app=AppRepo.getAll().find((app)=>app.name===name);
      const isNeverDeployed=app?.lastDeploy==undefined;
  if(!app){
    throw new Error("App not found");}
  
    const relDir = path.join(app.appDir, "release");
    const envDir = path.join(app.appDir, "env");
    const logDir = path.join(app.appDir, "logs");
    Logger.info(`Checking directories...`);
    if(!fs.existsSync(relDir)){
  
    Logger.info(`Creating directory ${relDir}`);
    fs.mkdirSync(relDir, { recursive: true });
  }
  if(!fs.existsSync(envDir)){
    Logger.info(`Creating directory ${envDir}`);
    fs.mkdirSync(envDir, { recursive: true });}
    if(!fs.existsSync(logDir)){
    Logger.info(`Creating directory ${logDir}`);
    fs.mkdirSync(logDir, { recursive: true });  }
    Logger.info(`Checking git repo...`);
      const isValidRepo =await simpleGit(relDir).checkIsRepo();
  if(!isDirectoryEmpty(relDir)&&!isValidRepo){
   throw new Error(`Please Make sure the directory ${relDir} is empty or is a valid git repository.`);
  }
  let noUpdate=false;
  if(!isValidRepo){
        fs.mkdirSync(relDir, { recursive: true });
        Logger.info(`Cloning ${app.repo} into ${relDir}`);
        await simpleGit().clone(app.repo, relDir);
        await simpleGit().checkout(app.branch);
  
        Logger.success(`Successfully cloned ${app.repo} into ${relDir}`);
      }
  else {
    await simpleGit().checkout(app.branch);
  await simpleGit(relDir).fetch();
  const status=await simpleGit(relDir).status();
  if(status.behind>0){
    throw new Error(`How can I deploy if you are ${status.behind} ahead!!! How did you even get here you?`);
  }
  if(status.ahead>0){
    Logger.info(`There are ${status.ahead} new commits in ${relDir}`);  
    await simpleGit(relDir).pull();
  }
  else{
    noUpdate=true;  
    Logger.info(`There are no new commits in ${relDir}`);
  }
  }
    let isChanged=await checkEnv(relDir,envDir);
    if(!isChanged&&noUpdate&&!isNeverDeployed){ 
     Logger.success(`Everything is up to date`);
     Logger.info("Checking app status...");
    const appStatus=await getAppStatus(name);
    Logger.advice(`App Status: ${appStatus}`);
    if(appStatus=="online"||appStatus=="launching"||appStatus=="stopping"){
      Logger.info("App is already running");
      process.exit(0);
    }
    }
  
  
  
  
  await prepare(relDir,{
    withInstall:isNeverDeployed|| noUpdate,
    withBuild:isNeverDeployed||isChanged||!noUpdate,
    withFix:false// Add skip lint in future
  });
  await runApp(relDir,{name:app.repo,port:app.port,instances:app.instances,
    output:path.join(logDir,"pm2.out.log"), error:path.join(logDir,"pm2.error.log") 
  });
  AppRepo.updateLastDeploy(name);
    };