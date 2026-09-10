import fs from "fs";
import path from "path";
import readline from "readline";
import { Logger } from "./logger.js";
import { handleRepo } from "./vcs-helper.js";
import { detectAppType, getRegisteredTypes } from "../app-types/index.js";
import { APP_DIR } from "../constants.js";
async function promptForType(prompt, options) {
  if (!process.stdin.isTTY) {
    throw new Error(`${prompt}
Pass --type explicitly to resolve this.`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    const numbered = options.map((o, i) => `  ${i + 1}. ${o}`).join("\n");
    rl.question(`${prompt}
${numbered}
Enter number or type name: `, (answer) => {
      rl.close();
      const chosen = options.find((o) => o === answer.trim()) ?? options[parseInt(answer, 10) - 1];
      if (!chosen) reject(new Error(`Invalid choice: "${answer}"`));
      else resolve(chosen);
    });
  });
}
async function detectProjectType(opts) {
  const { appName, repo, branch, projectDir, vcsType } = opts;
  const stagingDir = path.join(APP_DIR, ".detect-staging", appName);
  const stagingRelDir = path.join(stagingDir, "release");
  fs.mkdirSync(stagingRelDir, { recursive: true });
  try {
    Logger.info("Cloning repository for type detection...");
    await handleRepo({ vcsType, repo, branch }, stagingRelDir);
    let detectionDir = stagingRelDir;
    if (projectDir) {
      const subDir = path.join(stagingRelDir, projectDir);
      if (fs.existsSync(subDir)) {
        detectionDir = subDir;
      } else {
        Logger.warn(
          `--project-dir "${projectDir}" does not exist in the cloned repo. Falling back to repo root for detection.`
        );
      }
    }
    Logger.info("Detecting app type...");
    const result = await detectAppType(detectionDir);
    if (result.ambiguous && result.candidates) {
      const [top, second] = result.candidates;
      const msg2 = `App type is ambiguous (${top.projectType}: ${top.score}, ${second.projectType}: ${second.score}).`;
      if (!process.stdin.isTTY) throw new Error(`${msg2} Pass --type explicitly.`);
      Logger.warn(msg2);
      return await promptForType(
        "Please choose the app type:",
        result.candidates.map((c) => c.projectType)
      );
    }
    if (result.projectType) {
      Logger.info(`Detected app type: ${Logger.highlight(result.projectType)}`);
      return result.projectType;
    }
    const msg = "Cannot determine app type automatically.";
    if (!process.stdin.isTTY) throw new Error(`${msg} Pass --type explicitly.`);
    Logger.warn(msg);
    return await promptForType("Please choose the app type:", getRegisteredTypes());
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}
export {
  detectProjectType
};
