import { Logger } from "../utils/logger.js";
import { simpleGit } from "simple-git";
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const update = async () => {
  try {
    Logger.info("Updating dm tool...");
    if (!existsSync(path.join(projectRoot, ".git"))) {
      throw new Error("This command must be run from within a git repository");
    }
    const git = simpleGit(projectRoot);
    Logger.info("Fetching latest changes...");
    await git.fetch();
    const status = await git.status();
    if (status.behind > 0) {
      Logger.info(`Found ${status.behind} updates. Pulling changes...`);
      await git.pull();
      Logger.success("Pulled latest changes successfully.");
    } else {
      Logger.info("Already up to date.");
    }
    if (status.behind > 0) {
      Logger.info("Installing dependencies and building...");
      execSync("npm install", { cwd: projectRoot, stdio: "inherit" });
      Logger.success("Install and build completed successfully.");
    }
    Logger.success("dm tool updated successfully!");
  } catch (error) {
    Logger.error("Failed to update dm tool:", error);
    throw error;
  }
};
export {
  update
};
