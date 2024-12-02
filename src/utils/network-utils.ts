import portfinder from "portfinder";
import { Logger } from "./logger.js";

/**
 * Finds an available port within a given range, excluding known used ports.
 * @param {number[]} knownUsedPort - Array of ports to exclude.
 * @param {number} startPort - Starting port for the search (default: 50000).
 * @param {number} stopPort - Stopping port for the search (default: 50500).
 * @returns {Promise<number>} The available port number.
 */
export const findAvailablePort = async (knownUsedPort: number[] , startPort: number = 50000, stopPort: number = 50500): Promise<number> => {
  while (true) {
    try {
      const availablePort = await portfinder.getPortPromise({ startPort, stopPort });
      if (!knownUsedPort.includes(availablePort)) {
        Logger.success(`Found available port: ${availablePort}`);
        return availablePort;
      }
    } catch (err) {
      throw new Error(`Error finding available port: ${err}`);
    }
  }
};