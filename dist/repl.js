import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import { Logger } from "./utils/logger.js";
import { acquireLock, releaseLock } from "./utils/lock-utils.js";
import { REMOTE_AUDIT_LOG_PATH } from "./constants.js";
import {
  setReplInterface,
  getActiveRl,
  setReplFactory,
  isHandingOff
} from "./utils/repl-context.js";
import {
  COMMANDS,
  isGroup,
  resolveLeafArgs,
  ensureAppDirectories
} from "./command-registry.js";
function tokenise(line) {
  const tokens = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (cur.length) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}
function parseTokens(tokens, optionSpecs) {
  const positional = [];
  const flags = {};
  const flagTypes = /* @__PURE__ */ new Map();
  if (optionSpecs) {
    for (const [key, spec] of Object.entries(optionSpecs)) {
      const flagName = spec.flag ?? key;
      flagTypes.set(flagName, spec.type);
      if (spec.alias) flagTypes.set(spec.alias, spec.type);
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      const body = t.slice(2);
      if (body.includes("=")) {
        const [k, ...rest] = body.split("=");
        flags[k] = rest.join("=");
      } else {
        const flagType = flagTypes.get(body);
        const next = tokens[i + 1];
        if (flagType === "boolean") {
          flags[body] = true;
        } else if (next !== void 0 && !next.startsWith("-")) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else if (t.startsWith("-") && t.length === 2) {
      const key = t.slice(1);
      const flagType = flagTypes.get(key);
      const next = tokens[i + 1];
      if (flagType === "boolean") {
        flags[key] = true;
      } else if (next !== void 0 && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}
function optionSummary(options) {
  if (!options) return "";
  return Object.entries(options).map(([key, spec]) => {
    const flag = spec.flag ?? key;
    const token = `--${flag}${spec.alias ? `|-${spec.alias}` : ""} <${spec.type}>`;
    return spec.demandOption ? token : `[${token}]`;
  }).join(" ");
}
function buildLeafHelp(node) {
  const lines = [];
  lines.push(`
  ${chalk.bold(node.usage)}`);
  lines.push(`  ${chalk.gray(node.describe)}
`);
  if (node.positionals?.length) {
    lines.push(chalk.cyan("  Positionals:"));
    const col = Math.max(...node.positionals.map((p) => p.name.length)) + 2;
    for (const p of node.positionals) {
      const req = p.demandOption ? chalk.red(" [required]") : "";
      lines.push(`    ${p.name.padEnd(col)}${p.describe ?? ""}${req}`);
    }
    lines.push("");
  }
  if (node.options && Object.keys(node.options).length) {
    lines.push(chalk.cyan("  Options:"));
    const entries = Object.entries(node.options);
    const col = Math.max(...entries.map(([k, s]) => (s.flag ?? k).length)) + 4;
    for (const [key, spec] of entries) {
      const flag = spec.flag ?? key;
      const alias = spec.alias ? `-${spec.alias}, ` : "    ";
      const label = `${alias}--${flag}`;
      const meta = [`[${spec.type}]`];
      if (spec.choices) meta.push(`[choices: ${spec.choices.join(", ")}]`);
      if (spec.default !== void 0) meta.push(`[default: ${spec.default}]`);
      if (spec.demandOption) meta.push(chalk.red("[required]"));
      const desc = spec.describe ? `  ${spec.describe}` : "";
      lines.push(`    ${label.padEnd(col)}${meta.join(" ")}${desc}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
function buildHelp() {
  const groups = /* @__PURE__ */ new Map();
  const addLine = (group, line) => {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(line);
  };
  for (const [key, node] of Object.entries(COMMANDS)) {
    if (node.cliOnly) continue;
    if (isGroup(node)) {
      for (const [, subNode] of Object.entries(node.subcommands)) {
        if (isGroup(subNode)) continue;
        const opts = optionSummary(subNode.options);
        addLine(
          node.group,
          `    ${key} ${subNode.usage}${opts ? " " + opts : ""}`
        );
      }
    } else {
      const opts = optionSummary(node.options);
      addLine(node.group, `    ${node.usage}${opts ? " " + opts : ""}`);
    }
  }
  const sections = Array.from(groups.entries()).map(
    ([group, lines]) => `  ${chalk.cyan(group)}
${lines.join("\n")}`
  );
  return `
${chalk.bold("Deployment Manager \u2014 available commands")}

${sections.join("\n\n")}

  ${chalk.cyan(
    "Shell"
  )}
    help              Show this help
    clear             Clear the screen
    exit | quit       Exit the shell
`;
}
const TOP_LEVEL_COMMANDS = [
  ...Object.entries(COMMANDS).filter(([, node]) => !node.cliOnly).map(([key]) => key),
  "help",
  "clear",
  "exit",
  "quit"
];
async function runStreamingInRepl(node, args) {
  await new Promise((resolveDone) => {
    const existingSigInt = process.rawListeners("SIGINT").slice();
    process.removeAllListeners("SIGINT");
    const origExit = process.exit.bind(process);
    const restore = async () => {
      process.exit = origExit;
      process.removeAllListeners("SIGINT");
      for (const l of existingSigInt) process.on("SIGINT", l);
      Logger.nl();
      if (node.onStreamEnd) await node.onStreamEnd();
      resolveDone();
    };
    process.exit = () => restore();
    process.once("SIGINT", restore);
    void node.handler(args);
  });
}
async function runNode(node, fullUsage, rest) {
  if (isGroup(node)) {
    const [subKey, ...subRest] = rest;
    const subNode = subKey ? node.subcommands[subKey] : void 0;
    if (!subNode) {
      Logger.error(
        `Usage: ${fullUsage} <${Object.keys(node.subcommands).join("|")}>`
      );
      return;
    }
    const subUsage = isGroup(subNode) ? `${fullUsage} ${subKey}` : `${fullUsage} ${subNode.usage}`;
    await runNode(subNode, subUsage, subRest);
    return;
  }
  const { positional, flags } = parseTokens(rest, node.options);
  let args;
  try {
    args = resolveLeafArgs(node, positional, flags);
  } catch (err) {
    Logger.error(err?.message ?? String(err));
    Logger.print(buildLeafHelp(node));
    return;
  }
  if (node.lockArg) acquireLock(args[node.lockArg]);
  try {
    if (node.streaming) {
      await runStreamingInRepl(node, args);
    } else {
      await node.handler(args);
    }
  } finally {
    if (node.lockArg) releaseLock(args[node.lockArg]);
  }
}
async function dispatch(tokens) {
  if (tokens.length === 0) return;
  const [cmdKey, ...rest] = tokens;
  switch (cmdKey) {
    case "help":
      Logger.print(buildHelp());
      return;
    case "clear":
      process.stdout.write("\x1B[2J\x1B[H");
      return;
    case "exit":
    case "quit":
      Logger.print(chalk.gray("Goodbye."));
      process.exit(0);
  }
  if (REMOTE_USER && REMOTE_BLOCKED_COMMANDS.has(cmdKey)) {
    Logger.error(
      `Command "${chalk.bold(cmdKey)}" is not allowed in a remote session. Run it locally on the server.`
    );
    return;
  }
  const node = COMMANDS[cmdKey];
  if (!node) {
    Logger.error(
      `Unknown command: ${chalk.bold(cmdKey)}. Type ${chalk.cyan("help")} for available commands.`
    );
    return;
  }
  if (node.cliOnly) {
    Logger.error(
      `Command "${chalk.bold(cmdKey)}" is only available via the CLI (\`dm ${cmdKey}\`), not the interactive shell.`
    );
    return;
  }
  await runNode(node, isGroup(node) ? cmdKey : node.usage, rest);
}
const REMOTE_BLOCKED_COMMANDS = /* @__PURE__ */ new Set([
  "remote",
  // entire group: key-add, key-remove, set-password, serve…
  "update",
  // self-update could pull malicious code
  "install-service",
  // modifies OS startup configuration
  "migrate-db"
  // direct DB mutation outside normal app flow
]);
const REMOTE_USER = process.env.DM_REMOTE_USER;
function auditCommand(line) {
  if (!REMOTE_USER) return;
  try {
    const entry = JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      event: "repl-command",
      identity: REMOTE_USER,
      command: line
    });
    fs.appendFileSync(REMOTE_AUDIT_LOG_PATH, entry + "\n");
  } catch {
  }
}
async function startRepl(version) {
  await ensureAppDirectories();
  process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
  Logger.print(chalk.bold(`Deployment Manager v${version}`));
  Logger.print(chalk.gray('Type "help" for available commands.\n'));
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const createInterface = () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      // \x01 (SOH) and \x02 (STX) are readline zero-width markers used by
      // bash/zsh to correctly compute cursor position around color sequences.
      // Node.js readline does NOT use them — they print as literal garbage
      // characters on legacy Windows conhost. Removed entirely; chalk handles
      // color stripping automatically when the terminal doesn't support it.
      prompt: `${chalk.cyan("dm>")} `,
      completer: (line) => {
        const hits = TOP_LEVEL_COMMANDS.filter((c) => c.startsWith(line));
        return [hits.length ? hits : TOP_LEVEL_COMMANDS, line];
      }
    });
    rl.on("close", () => {
      if (isHandingOff()) return;
      setReplInterface(null);
      resolveExit();
    });
    rl.on("line", async (rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        rl.prompt();
        return;
      }
      auditCommand(line);
      const tokens = tokenise(line);
      try {
        await dispatch(tokens);
      } catch (err) {
        Logger.error(err?.message ?? err);
      }
      if (getActiveRl() === rl) rl.prompt();
    });
    return rl;
  };
  setReplFactory(createInterface);
  setReplInterface(createInterface());
  getActiveRl().prompt();
  await exited;
}
export {
  startRepl
};
