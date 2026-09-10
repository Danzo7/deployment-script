import portfinder from "portfinder";
import { Logger } from "./logger.js";
const findAvailablePort = async (knownUsedPort, startPort = 5e4, stopPort = 50999) => {
  portfinder.basePort = startPort;
  while (startPort <= stopPort) {
    try {
      const availablePort = await portfinder.getPortPromise({
        port: startPort,
        stopPort
      });
      if (!knownUsedPort.includes(availablePort)) {
        Logger.success(`Found available port: ${availablePort}`);
        return availablePort;
      }
      startPort = availablePort + 1;
    } catch (err) {
      Logger.error(`Error finding available port`);
      throw err;
    }
  }
  throw new Error(
    `No available port found in range ${startPort} to ${stopPort}, excluding: ${knownUsedPort.join(
      ", "
    )}`
  );
};
export {
  findAvailablePort
};
