import Table from "cli-table3";
import chalk from "chalk";
import { AppRepo } from "../db/repos.js";
import { App } from "../db/model.js";
import { getAppStatus } from "../utils/pm2-helper.js";

export const listApps = async () => {


  // Read the directory to get all apps
  const apps:(App&{status?:string})[] = AppRepo.getAll();
  await Promise.all(apps.map(async (app) => ({app,
    status: await getAppStatus(app.name)
  })));

  // Create a table
  const table = new Table({
    head: [chalk.cyan("#"), chalk.greenBright("Name"), chalk.blue("Port"), chalk.yellow("Last Deployed"), chalk.magenta("Status")],
  });

  apps.forEach((app, index) => {
    table.push([
      chalk.cyan(index + 1),
      chalk.greenBright(app.name),
      chalk.blue(app.port),
      chalk.yellow(app.lastDeploy),
      chalk.magenta(app.status),
    ]);
  });

  // Print the table
  console.log(table.toString());
};