import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const APP_DIR =
  process.env?.APP_DIR ?? path.join(ROOT_DIR, '.applications');
export const LOCK_DIR = path.resolve(ROOT_DIR, '.locks');
