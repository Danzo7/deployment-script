import { Logger } from './logger.js';

export const withRetry = async <T>(
  name: string,
  operation: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> => {
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

  throw new Error('Unreachable code in retry logic');
};

export const withBackoffRetry = async <T>(
  name: string,
  operation: () => Promise<T>,
  retries: number = 5,
  baseDelayMs: number = 2000
): Promise<T> => {
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
      Logger.warn(`${name} failed. Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unreachable code in retry logic');
};
