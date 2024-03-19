import fs from "fs";
import fsExtra from "fs-extra";
import path, { dirname, resolve } from "path";
import dotenv from "dotenv";
import { simpleGit } from "simple-git";
import { spawnSync } from "child_process";
import extract from "extract-zip";
import yargs from "yargs";
import { fileURLToPath } from "url";

dotenv.config({ path: ".env" });
const argv = yargs(process.argv.slice(2))
  .options({
    "app-name": {
      alias: "n",
      describe: "Name of the application",
      demandOption: true,
      type: "string",
    },
    repo: {
      alias: "r",
      describe: "Git repository or Zip file containing the application",
      demandOption: true,
      type: "string",
    },
    "env-dir": {
      alias: "e",
      describe: "Directory containing environment files",
      type: "string",
    },
  })
  .help()
  .alias("help", "h").argv;

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { APP_DIR } = process.env;
const generateRunner = (dir: string) => {
  const scriptPath = fileURLToPath(import.meta.url);

  const batchScript = `@echo off\nnode ${scriptPath} %*`;
  try {
    fs.writeFileSync(path.join(dir, "rundeploy.bat"), batchScript);
    console.log("rundeploy.bat file created successfully.");
  } catch (err) {
    console.error("Error creating rundeploy.bat file:", err);
    return false;
  }
  return true;
};
const prepare = (dir: string) => {
  console.log("Preparing");
  console.log("Insalling packages...");
  const npmInstall = spawnSync("npm", ["install"], {
    cwd: dir,
    stdio: "inherit",
    shell: true,
  });

  if (npmInstall.error) {
    console.error("Error occurred during npm install:", npmInstall.error);
    return false;
  } else if (npmInstall.status !== 0) {
    console.error("npm install failed with status code:", npmInstall.status);
    return false;
  } else {
    console.log("npm install completed successfully");
  }
  console.log("Building...");
  const nextBuild = spawnSync("npx", ["next", "build"], {
    cwd: dir,
    stdio: "inherit",
    shell: true,
  });

  if (nextBuild.error) {
    console.error("Error occurred during npx next build:", nextBuild.error);
    return false;
  } else if (nextBuild.status !== 0) {
    console.error("npx next build failed with status code:", nextBuild.status);
    return false;
  } else {
    console.log("npx next build completed successfully");
  }
  return true;
};
const executePM2Commands = (appName: string, dir: string) => {
  // Delete PM2 process
  const deleteProcess = spawnSync("npx", ["pm2", "delete", appName], {
    cwd: dir,
    stdio: "inherit",
    shell: true,
  });
  if (deleteProcess.status === 0) {
    console.log(`PM2 process "${appName}" deleted successfully`);
  } else {
    console.log(`Could not delete PM2 process ${appName}, Skip.`);
  }
  // Start PM2 process
  const startProcess = spawnSync("npx", ["pm2", "start"], {
    cwd: dir,
    stdio: "inherit",
    shell: true,
  });
  if (startProcess.status === 0) {
    console.log(`PM2 process started successfully`);
  } else {
    console.error(`Error starting PM2 process.`);
    return false;
  }
  return true;
};
const preserveEnv = async (currentDir: string, releaseDir: string) => {
  try {
    // Ensure release directory exists
    await fsExtra.ensureDir(releaseDir);

    const files = fs.readdirSync(currentDir);

    const envFiles = files.filter((file) => file.startsWith(".env"));

    if (envFiles.length > 0) {
      for (const envFile of envFiles) {
        const sourcePath = path.join(currentDir, envFile);
        const targetPath = path.join(releaseDir, envFile);
        await fsExtra.copy(sourcePath, targetPath, { overwrite: true });
        console.log(`Preserved old environment file: ${envFile}`);
      }
    } else {
      console.log("No old environment files found in the current directory");
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error preserving old environment files:", error);
    return false;
  }
};
const cleanupOldReleases = (releaseDir: string, releasesDir: string) => {
  try {
    const allReleases = fs.readdirSync(releasesDir);
    const oldReleases = allReleases.filter(
      (release) => path.join(releasesDir, release) !== releaseDir
    );
    oldReleases.forEach((oldRelease) => {
      const releasePath = path.join(releasesDir, oldRelease);
      console.log(`Removing old release: ${releasePath}`);
      try {
        fsExtra.removeSync(releasePath);
      } catch {
        console.log(`Failed to remove : ${releasePath}`);
      }
    });

    console.log("Old releases cleaned up successfully");
  } catch (error) {
    console.error("Error cleaning up old releases:", error);
  }
};

const clone = async (repo: string, dir: string) => {
  try {
    if (repo.endsWith(".git")) {
      console.log(`Cloning ${repo} into ${dir}`);
      await simpleGit().clone(repo, dir);
    } else if (repo.endsWith(".zip")) {
      console.log(`Unzipping ${repo} into ${dir}`);
      await extract(repo, { dir });

      const files = fs.readdirSync(dir);
      if (
        files.length === 1 &&
        fs.statSync(path.join(dir, files[0])).isDirectory()
      ) {
        const subDir = path.join(dir, files[0]);
        console.log(`Moving files from ${subDir} to ${dir}`);
        fs.readdirSync(subDir).forEach((file) => {
          fsExtra.moveSync(path.join(subDir, file), path.join(dir, file));
        });
        fs.rmdirSync(subDir);
      }
    } else {
      console.error("Unsupported repository format");
      return false;
    }
  } catch (error) {
    console.error("Error cloning repository:", error);
    return false;
  }
  return true;
};
const deploy = async (
  appName: string,
  appDir: string,
  repo: string,
  envDir?: string
) => {
  try {
    appDir = path.join(appDir, appName);
    const lockFilePath = path.join(appDir, "lock.pid");

    if (fs.existsSync(lockFilePath)) {
      console.log("Another instance of the script is already running.");
      process.exit(0);
    }

    fs.writeFileSync(lockFilePath, process.pid.toString(), { flag: "wx" });

    process.on("exit", () => {
      fs.unlinkSync(lockFilePath);
    });

    const currentDir = path.join(appDir, "current");
    const isFirstDeploy = !fs.existsSync(currentDir);

    const date = new Date().toISOString().replace(/[^0-9]/g, "");
    const releaseDir = path.join(appDir, "releases", date);
    console.log(`Creating ${releaseDir}`);
    fs.mkdirSync(releaseDir, { recursive: true });
    if (!(await clone(repo, releaseDir))) {
      throw new Error("Error cloning repository");
    }
    if (
      !isFirstDeploy &&
      (await simpleGit(currentDir).checkIsRepo()) &&
      (await simpleGit(releaseDir).checkIsRepo())
    ) {
      console.log(`Checking if it's a new commit`);

      const newCommit = await simpleGit(releaseDir).revparse([
        "--short",
        "HEAD",
      ]);
      const lastCommit = await simpleGit(currentDir).revparse([
        "--short",
        "HEAD",
      ]);
      if (lastCommit === newCommit) {
        console.log("Commit is same hash, aborting!!");
        fs.rmdirSync(releaseDir, { recursive: true });
        process.exit(1);
      }
    } else {
      if (!isFirstDeploy) console.log("Skip commit compare (No git repo)");
    }

    if (!isFirstDeploy) {
      console.log(`Preserved old environment files.`);
      await preserveEnv(currentDir, releaseDir);
    }
    if (envDir) {
      console.log(`fetch new environment files.`);
      await preserveEnv(currentDir, envDir);
    }

    // if (!isFirstDeploy&&fs.existsSync(path.join(currentDir, 'node_modules'))) {
    //   console.log(`Moving node_modules directory to ${releaseDir}`);
    //   fsExtra.copySync(path.join(currentDir, 'node_modules'), path.join(releaseDir, 'node_modules'));
    // }

    if (!generateRunner(releaseDir) || !prepare(releaseDir)) {
      fs.rmdirSync(releaseDir, { recursive: true });
      throw new Error("failed. aborting!!");
    }
    console.log(`Linking ${releaseDir} to ${currentDir}`);
    if (!isFirstDeploy) fsExtra.unlinkSync(currentDir);
    fs.symlinkSync(releaseDir, currentDir, "dir");
    executePM2Commands(appName, releaseDir);

    cleanupOldReleases(releaseDir, path.join(appDir, "releases"));
    console.log("Deployed!");
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
};

const { appName, repo, envDir } = await argv;
if (!appName) {
  throw new Error("APP_NAME is not defined");
}

if (!repo) {
  throw new Error("REPO is not defined");
}
deploy(appName, APP_DIR ?? path.join(ROOT_DIR, ".applications"), repo, envDir);
