import { Logger } from "./logger.js";
const withRetry = async (name, operation, retries = 3, delay = 1e3) => {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        Logger.error(`${name} failed after ${retries} attempts.`);
        throw err;
      }
      Logger.warn(`${name} Failed. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable code in retry logic");
};
const withBackoffRetry = async (name, operation, retries = 5, baseDelayMs = 2e3) => {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        Logger.error(`${name} failed after ${retries} attempts.`);
        throw err;
      }
      const delay = baseDelayMs * attempt;
      Logger.warn(`${name} failed. Retrying in ${delay / 1e3}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable code in retry logic");
};
export {
  withBackoffRetry,
  withRetry
};
