#!/usr/bin/env node
import { ensureDefaultConfig, isFirstRun } from "./utils/first-run-setup.js";
import { migrateFromJSON } from "./commands/migrate-db.js";
import chalk from "chalk";
import { homedir } from "os";
import path from "path";
async function setup() {
  try {
    const firstRun = isFirstRun();
    ensureDefaultConfig();
    await migrateFromJSON();
    if (firstRun) {
      const dmPath = path.join(homedir(), ".dm").replace(homedir(), "~");
      console.log("");
      console.log(chalk.cyan("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510"));
      console.log(chalk.cyan("\u2502") + "                                                             " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "  " + chalk.bold.white("\u{1F680} dm - Deployment Manager") + "                            " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "     " + chalk.gray("Setup completed successfully") + "                         " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "                                                             " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524"));
      console.log(chalk.cyan("\u2502") + "                                                             " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "  " + chalk.white("Data directory:") + " " + chalk.green(dmPath.padEnd(37)) + " " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "  " + chalk.white("Config file:   ") + " " + chalk.green((dmPath + "/.env").padEnd(37)) + " " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "  " + chalk.white("Database:      ") + " " + chalk.green("Ready".padEnd(37)) + " " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "                                                             " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524"));
      console.log(chalk.cyan("\u2502") + "  " + chalk.bold("Quick Start:") + "                                           " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "                                                             " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "    " + chalk.yellow("dm init") + " " + chalk.gray("<app-name>") + " " + chalk.yellow("--repo") + " " + chalk.gray("<repo-url>") + "            " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "    " + chalk.yellow("dm dashboard") + "                                        " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "    " + chalk.yellow("dm --help") + "                                           " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2502") + "                                                             " + chalk.cyan("\u2502"));
      console.log(chalk.cyan("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518"));
      console.log("");
    }
  } catch (error) {
    console.error(chalk.red("\u2717 dm setup failed:"), error);
    process.exit(1);
  }
}
setup();
