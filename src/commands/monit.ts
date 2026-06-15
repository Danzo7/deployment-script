import { spawn } from 'child_process';
import { Logger } from '../utils/logger.js';

export const monit = () => {
  const child = spawn('pm2', ['monit'], { stdio: 'inherit', shell: true });
  child.on('error', (err) => Logger.error('Failed to start pm2 monit:', err));
};
