import fs from "fs";
import path from "path";
import fsExtra from "fs-extra";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { Logger } from "../utils/logger.js";
import { applyStorageSymlinks } from "../utils/file-utils.js";
import { STATIC_DIR } from "../constants.js";
import { registerHandler } from "./registry.js";
const _dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_SERVER_SCRIPT = resolve(_dirname, "..", "static-server", "serve.js");
const staticHandler = {
  typeKey: "static",
  buildPm2Config(input) {
    const { name, port, config } = input;
    return {
      name,
      cwd: input.dir,
      script: STATIC_SERVER_SCRIPT,
      args: void 0,
      instances: config.instances,
      max_memory_restart: config.maxMemory,
      ...config.autorestart !== null && config.autorestart !== void 0 ? { autorestart: config.autorestart } : {},
      ...config.maxRestarts !== null && config.maxRestarts !== void 0 ? { max_restarts: config.maxRestarts } : {},
      ...config.minUptime ? { min_uptime: config.minUptime } : {},
      ...config.restartDelay !== null && config.restartDelay !== void 0 ? { restart_delay: config.restartDelay } : {},
      ...config.killTimeout !== null && config.killTimeout !== void 0 ? { kill_timeout: config.killTimeout } : {},
      ...config.nodeArgs ? { node_args: config.nodeArgs } : {},
      env: {
        NODE_ENV: "production",
        PORT: port.toString()
      }
    };
  },
  createBuildDir({ appDir, projectDir, storages }) {
    const buildDir = path.join(appDir, "builds", "build-" + Date.now());
    const releaseDir = path.join(appDir, "release");
    const sourceRoot = projectDir ? path.join(releaseDir, projectDir) : releaseDir;
    const distFolder = path.join(sourceRoot, "dist");
    const buildFolder = path.join(sourceRoot, "build");
    let staticSource;
    if (fs.existsSync(distFolder)) {
      staticSource = distFolder;
    } else if (fs.existsSync(buildFolder)) {
      staticSource = buildFolder;
    }
    if (!staticSource) {
      throw new Error(
        `No static output folder found for static app.
Expected a "dist/" or "build/" folder inside ${sourceRoot}.
Make sure your site is built before deploying (e.g. run "npm run build" locally and commit the output, or use a CI step that produces dist/ or build/).`
      );
    }
    fs.mkdirSync(buildDir, { recursive: true });
    fsExtra.copySync(staticSource, buildDir);
    Logger.info(
      `Copied static output from "${path.basename(staticSource)}/" into build directory.`
    );
    applyStorageSymlinks(buildDir, storages ?? []);
    return buildDir;
  },
  getNginxLocationDirectives() {
    return [];
  },
  async prepareRelease(dir, opts) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      throw new Error(
        'Static apps must have their output pre-built and committed.\nPlease build your project locally (e.g. "npm run build") and commit the dist/ or build/ folder to the repository.\ndm does not run build steps for static apps.'
      );
    }
  },
  getAppsDir() {
    return STATIC_DIR;
  },
  getExecMode() {
    return "cluster";
  },
  getDisplayName(unicode) {
    return unicode ? "\u{1F4C4} Static" : "Static";
  },
  async syncConfig(_buildRelDir, _envDir) {
    return false;
  },
  async detect(dir) {
    const candidates = ["dist", "build"];
    for (const folder of candidates) {
      const folderPath = path.join(dir, folder);
      if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory() && fs.existsSync(path.join(folderPath, "index.html"))) {
        return 85;
      }
    }
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return 70;
    }
    return 0;
  }
};
registerHandler(staticHandler);
export {
  staticHandler
};
