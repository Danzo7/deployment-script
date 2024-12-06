import portfinder from 'portfinder';
import { Logger } from './logger.js';

/**
 * Finds an available port within a given range, excluding known used ports.
 * @param {number[]} knownUsedPort - Array of ports to exclude.
 * @param {number} startPort - Starting port for the search (default: 50000).
 * @param {number} stopPort - Stopping port for the search (default: 50500).
 * @returns {Promise<number>} The available port number.
 */
export const findAvailablePort = async (
  knownUsedPort: number[],
  startPort: number = 50000,
  stopPort: number = 50500
): Promise<number> => {
  portfinder.basePort = startPort; // Set the base port for portfinder.

  while (startPort <= stopPort) {
    try {
      const availablePort = await portfinder.getPortPromise({
        port: startPort,
        stopPort,
      });

      if (!knownUsedPort.includes(availablePort)) {
        Logger.success(`Found available port: ${availablePort}`);
        return availablePort;
      }

      startPort = availablePort + 1; // Increment the starting port to avoid re-checking.
    } catch (err) {
      Logger.error(`Error finding available port: ${err}`);
      throw err;
    }
  }

  throw new Error(
    `No available port found in range ${startPort} to ${stopPort}, excluding: ${knownUsedPort.join(
      ', '
    )}`
  );
};
