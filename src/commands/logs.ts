import { spawn } from 'child_process';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export const logs = ({ name }: { name: string }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  const child = spawn('pm2', ['logs', name], { stdio: 'inherit', shell: true });
  child.on('error', (err) => Logger.error('Failed to start pm2 logs:', err));
};
