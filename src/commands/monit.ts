import { spawn } from 'child_process';
import { Logger } from '../utils/logger.js';
import { PM2_BIN } from '../constants.js';

export const monit = () => {
  const child = spawn(PM2_BIN, ['monit'], { stdio: 'inherit' });
  child.on('error', (err) => Logger.error('Failed to start pm2 monit:', err));
};
