import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';import dotenv from 'dotenv';


export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)),"..");
dotenv.config({path: path.join(ROOT_DIR, '.env')});
export const APP_DIR =
  process.env?.APP_DIR ?? path.join(ROOT_DIR, '.applications');
export const LOCK_DIR = path.resolve(ROOT_DIR, '.locks');
