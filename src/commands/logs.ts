import { spawn } from 'child_process';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { PM2_BIN } from '../constants.js';

export const logs = ({ name }: { name: string }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  const child = spawn(PM2_BIN, ['logs', name], { stdio: 'inherit' });
  child.on('error', (err) => Logger.error('Failed to start pm2 logs:', err));
  child.on('close', (code) => process.exit(code ?? 0));
};
