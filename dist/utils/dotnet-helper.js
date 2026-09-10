import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { calculateFileHash } from "./file-utils.js";
import { Logger } from "./logger.js";
const checkDotnetInstalled = () => {
  try {
    execSync("dotnet --version", { stdio: "pipe", encoding: "utf8" });
    return true;
  } catch {
    Logger.warn(
      ".NET SDK is not installed or not on your PATH.\n  \u2192 Install it from https://dotnet.microsoft.com/download\n  \u2192 The app was registered but 'dm deploy' will fail until .NET is available."
    );
    return false;
  }
};
const runCommand = (command, options) => {
  const execOptions = {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    encoding: "utf8"
  };
  try {
    const stdout = execSync(command, execOptions);
    fs.appendFileSync(
      options.logFile,
      `Command: ${command}
Output:
${stdout}

`,
      "utf8"
    );
    return { code: 0, stdout: stdout?.toString(), stderr: null };
  } catch (err) {
    const stdout = err.stdout?.toString() || "";
    const stderr = err.stderr?.toString() || "";
    const errorMessage = stderr || stdout || err.message;
    fs.appendFileSync(
      options.logFile,
      `Command: ${command}
Error:
${errorMessage}

`,
      "utf8"
    );
    return {
      code: err.status || 1,
      stdout: null,
      stderr: errorMessage
    };
  }
};
const findCsprojFile = (relDir) => {
  const files = fs.readdirSync(relDir);
  const csproj = files.find((f) => f.endsWith(".csproj"));
  return csproj ? path.join(relDir, csproj) : null;
};
const checkDotnetSdk = async (relDir) => {
  let installedVersion;
  try {
    installedVersion = execSync("dotnet --version", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
    throw new Error(
      "dotnet SDK not found. Install the .NET SDK from https://dotnet.microsoft.com/download and ensure 'dotnet' is on your PATH."
    );
  }
  const csprojPath = findCsprojFile(relDir);
  if (!csprojPath) {
    throw new Error(
      "No .csproj file found in the repository. Make sure your .NET project has a .csproj file at the repository root."
    );
  }
  const csprojContent = fs.readFileSync(csprojPath, "utf-8");
  const targetFrameworkMatch = csprojContent.match(
    /<TargetFramework>([^<]+)<\/TargetFramework>/
  );
  const targetFramework = targetFrameworkMatch?.[1] ?? "";
  const requiredMajorMatch = targetFramework.match(/net(\d+)/);
  const requiredMajor = requiredMajorMatch ? parseInt(requiredMajorMatch[1], 10) : null;
  const installedMajor = parseInt(installedVersion.split(".")[0], 10);
  if (requiredMajor !== null && installedMajor < requiredMajor) {
    throw new Error(
      `dotnet SDK version mismatch: project requires .NET ${requiredMajor} but found ${installedMajor}. Upgrade the SDK from https://dotnet.microsoft.com/download.`
    );
  }
};
const checkAppSettings = async (relDir, envDir) => {
  const settingsFiles = ["appsettings.json", "appsettings.Production.json"];
  let anyChanged = false;
  let anyFoundInEnvDir = false;
  for (const fileName of settingsFiles) {
    const envFilePath = path.join(envDir, fileName);
    const relFilePath = path.join(relDir, fileName);
    if (!fs.existsSync(envFilePath)) {
      continue;
    }
    anyFoundInEnvDir = true;
    const envHash = calculateFileHash(envFilePath);
    const relHash = calculateFileHash(relFilePath);
    if (envHash !== relHash) {
      fs.copyFileSync(envFilePath, relFilePath);
      Logger.success(`Updated ${fileName}`);
      anyChanged = true;
    } else {
      Logger.info(`${fileName} is up to date.`);
    }
  }
  if (!anyFoundInEnvDir) {
    Logger.info("No appsettings files found in env directory.");
    return false;
  }
  return anyChanged;
};
const ensureAssemblyName = async (relDir, appName) => {
  const csprojPath = findCsprojFile(relDir);
  if (!csprojPath) {
    throw new Error(
      "No .csproj file found in the repository. Make sure your .NET project has a .csproj file at the repository root."
    );
  }
  let csprojContent = fs.readFileSync(csprojPath, "utf-8");
  const assemblyNameMatch = csprojContent.match(
    /<AssemblyName>([^<]+)<\/AssemblyName>/
  );
  if (assemblyNameMatch) {
    const foundName = assemblyNameMatch[1].trim();
    if (foundName !== appName) {
      csprojContent = csprojContent.replace(
        /<AssemblyName>[^<]+<\/AssemblyName>/,
        `<AssemblyName>${appName}</AssemblyName>`
      );
      fs.writeFileSync(csprojPath, csprojContent, "utf-8");
      Logger.warn(
        `Updated .csproj: Changed <AssemblyName> from "${foundName}" to "${appName}"`
      );
    }
  } else {
    const projectFile = path.basename(csprojPath, ".csproj");
    if (projectFile !== appName) {
      const propertyGroupMatch = csprojContent.match(/(<PropertyGroup[^>]*>)/);
      if (propertyGroupMatch) {
        const insertionPoint = propertyGroupMatch.index + propertyGroupMatch[0].length;
        csprojContent = csprojContent.slice(0, insertionPoint) + `
    <AssemblyName>${appName}</AssemblyName>` + csprojContent.slice(insertionPoint);
        fs.writeFileSync(csprojPath, csprojContent, "utf-8");
        Logger.warn(
          `Updated .csproj: Added <AssemblyName>${appName}</AssemblyName> to match registered app name`
        );
      } else {
        throw new Error(
          "Could not find <PropertyGroup> in .csproj file. Please add <AssemblyName> manually."
        );
      }
    }
  }
};
const prepareDotnet = async (dir, opts) => {
  const logFile = path.join(opts.logDir, "prepare-" + Date.now() + ".log");
  Logger.info("Running dotnet restore...");
  const restoreResult = runCommand("dotnet restore", { cwd: dir, logFile });
  if (restoreResult.code !== 0) {
    throw new Error(`dotnet restore failed: ${restoreResult.stderr}`);
  }
  Logger.info("Running dotnet publish...");
  const publishResult = runCommand("dotnet publish -c Release -o ./publish", {
    cwd: dir,
    logFile
  });
  if (publishResult.code !== 0) {
    throw new Error(`dotnet publish failed: ${publishResult.stderr}`);
  }
};
export {
  checkAppSettings,
  checkDotnetInstalled,
  checkDotnetSdk,
  ensureAssemblyName,
  prepareDotnet
};
