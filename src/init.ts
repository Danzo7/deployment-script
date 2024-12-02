import fs from "fs";
import fsExtra from "fs-extra";
import path, { dirname, resolve } from "path";
import dotenv from "dotenv";
import { simpleGit } from "simple-git";
import { spawnSync } from "child_process";
import extract from "extract-zip";
import yargs from "yargs";
import { fileURLToPath } from "url";
import { rimraf } from "rimraf";
dotenv.config({ path: ".env" });


const argv = yargs(process.argv.slice(2))
  .options({
    "app-name": {
      alias: "n",
      describe: "Name of the application",
      demandOption: true,
      type: "string",
    },
    port: {
      alias: "p",
      describe: "Port of the application",
      type: "number",
      demandOption: true,
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
    "instances": {
      alias: "i",
      describe: "Number of instances",
      type: "number",
    },
  })
  .help()
  .alias("help", "h").argv;
