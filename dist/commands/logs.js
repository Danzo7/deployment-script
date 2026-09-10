import pm2 from "pm2";
import { AppRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import {
  openSharedPm2,
  closeSharedPm2,
  readAppLogs
} from "../utils/pm2-helper.js";
const logs = async ({ name }) => {
  await AppRepo.findByName(name);
  let bus = null;
  let sigintHandler = null;
  let sigtermHandler = null;
  const cleanup = () => {
    if (sigintHandler) {
      process.removeListener("SIGINT", sigintHandler);
      sigintHandler = null;
    }
    if (sigtermHandler) {
      process.removeListener("SIGTERM", sigtermHandler);
      sigtermHandler = null;
    }
    if (bus) {
      try {
        bus.close();
      } catch {
      }
      bus = null;
    }
    closeSharedPm2();
  };
  try {
    await openSharedPm2();
    const historicalLogs = await readAppLogs(name, 100);
    for (const line of historicalLogs) {
      if (line.includes("[err]")) {
        process.stderr.write(line + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
    }
    await new Promise((resolve, reject) => {
      pm2.launchBus((busErr, busInstance) => {
        if (busErr) {
          return reject(busErr);
        }
        bus = busInstance;
        Logger.info(
          `Streaming logs for "${Logger.highlight(name)}" (Ctrl+C to stop)...
`
        );
        bus.on("log:out", (packet) => {
          if (packet.process?.name === name) {
            process.stdout.write(`[${packet.process.name}] ${packet.data}
`);
          }
        });
        bus.on("log:err", (packet) => {
          if (packet.process?.name === name) {
            process.stderr.write(
              `[${packet.process.name}][err] ${packet.data}
`
            );
          }
        });
        bus.on("process:exception", (packet) => {
          if (packet.process?.name === name) {
            process.stderr.write(
              `[${packet.process.name}][exception] ${JSON.stringify(packet.data)}
`
            );
          }
        });
        sigintHandler = () => {
          cleanup();
          resolve();
        };
        sigtermHandler = () => {
          cleanup();
          resolve();
        };
        process.on("SIGINT", sigintHandler);
        process.on("SIGTERM", sigtermHandler);
      });
    });
  } catch (err) {
    cleanup();
    throw err;
  }
};
export {
  logs
};
