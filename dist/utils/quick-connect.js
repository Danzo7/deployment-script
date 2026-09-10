import { Logger } from "./logger.js";
import { REMOTE_PORT } from "../constants.js";
import { connectRemote } from "./ssh-client.js";
async function handleQuickConnect(rawArgs) {
  const atHostIdx = rawArgs.findIndex((a) => a.startsWith("@"));
  if (atHostIdx !== -1) {
    const atHostArg = rawArgs[atHostIdx];
    const hostPart = atHostArg.slice(1);
    if (!hostPart) {
      Logger.error(
        "Invalid @host syntax. Example: dm @10.10.10.10 deploy myapp"
      );
      process.exit(1);
    }
    let host;
    let port;
    if (hostPart.includes(":")) {
      const [h, p] = hostPart.split(":");
      host = h;
      port = parseInt(p, 10);
      if (isNaN(port)) {
        Logger.error(`Invalid port in @host:port syntax: ${p}`);
        process.exit(1);
      }
    } else {
      host = hostPart;
    }
    const identIdx = rawArgs.findIndex((a) => a === "--identity" || a === "-i");
    const identity = identIdx !== -1 ? rawArgs[identIdx + 1] : void 0;
    const commandArgs = [];
    for (let i = atHostIdx + 1; i < rawArgs.length; i++) {
      if (rawArgs[i] === "--identity" || rawArgs[i] === "-i") {
        i++;
        continue;
      }
      commandArgs.push(rawArgs[i]);
    }
    await connectRemote(
      host,
      port,
      identity,
      commandArgs.length > 0 ? commandArgs : void 0
    );
    return true;
  }
  const hostIdx = rawArgs.findIndex((a) => a === "--host" || a === "-H");
  if (hostIdx !== -1) {
    const host = rawArgs[hostIdx + 1];
    if (!host || host.startsWith("-")) {
      Logger.error("--host requires a value, e.g. dm --host 10.10.10.10");
      process.exit(1);
    }
    const portIdx = rawArgs.findIndex((a) => a === "--port" || a === "-p");
    const port = portIdx !== -1 ? Number(rawArgs[portIdx + 1]) : REMOTE_PORT;
    const identIdx = rawArgs.findIndex((a) => a === "--identity" || a === "-i");
    const identity = identIdx !== -1 ? rawArgs[identIdx + 1] : void 0;
    const knownFlags = /* @__PURE__ */ new Set([
      "--host",
      "-H",
      "--port",
      "-p",
      "--identity",
      "-i"
    ]);
    const commandArgs = [];
    let skipNext = false;
    for (let i = 0; i < rawArgs.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (knownFlags.has(rawArgs[i])) {
        skipNext = true;
        continue;
      }
      if (i > 0 && knownFlags.has(rawArgs[i - 1])) {
        continue;
      }
      if (rawArgs[i].startsWith("-")) {
        continue;
      }
      commandArgs.push(rawArgs[i]);
    }
    await connectRemote(
      host,
      port,
      identity,
      commandArgs.length > 0 ? commandArgs : void 0
    );
    return true;
  }
  return false;
}
export {
  handleQuickConnect
};
