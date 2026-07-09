import pm2 from 'pm2';
import chalk from 'chalk';
import { Logger } from '../utils/logger.js';

const REFRESH_MS = 2000;

const statusColor = (status: string) => {
  switch (status) {
    case 'online':   return chalk.green(status);
    case 'errored':  return chalk.red(status);
    case 'stopped':  return chalk.yellow(status);
    case 'stopping': return chalk.yellow(status);
    default: return status;
  }
};

const formatMem = (bytes?: number) => {
  if (bytes == null) return 'N/A';
  return `${Math.round(bytes / 1024 / 1024)} MB`;
};

const formatUptime = (pmUptime?: number) => {
  if (!pmUptime) return 'N/A';
  const uptimeSec = Math.floor((Date.now() - pmUptime) / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  return `${h}h ${m}m ${s}s`;
};

const renderTable = (list: pm2.ProcessDescription[]) => {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  console.log(`${chalk.bold('PM2 Monitor')}  (Ctrl+C to exit)\n`);
  console.log(
    'ID'.padEnd(5) +
    'Name'.padEnd(25) +
    'Status'.padEnd(12) +
    'CPU'.padEnd(8) +
    'Memory'.padEnd(12) +
    'Uptime'.padEnd(15) +
    'Restarts'
  );
  console.log('-'.repeat(85));

  for (const proc of list) {
    const env = proc.pm2_env as any;
    const id = String(proc.pm_id ?? '').padEnd(5);
    const name = (proc.name ?? '').padEnd(25);
    const rawStatus = (env?.status ?? 'unknown').padEnd(12);
    const status = statusColor(rawStatus);
    const cpu = `${proc.monit?.cpu ?? 0}%`.padEnd(8);
    const mem = formatMem(proc.monit?.memory).padEnd(12);
    const uptime = formatUptime(env?.pm_uptime).padEnd(15);
    const restarts = String(env?.restart_time ?? 0);
    console.log(`${id}${name}${status}${cpu}${mem}${uptime}${restarts}`);
  }
};

export const monit = () => {
  pm2.connect((connectErr) => {
    if (connectErr) {
      Logger.error('Failed to connect to pm2:', connectErr);
      process.exit(1);
    }

    const refresh = () => {
      pm2.list((err, list) => {
        if (err) {
          Logger.error('Failed to list pm2 processes:', err);
          return;
        }
        renderTable(list);
      });
    };

    refresh();
    const interval = setInterval(refresh, REFRESH_MS);

    process.on('SIGINT', () => {
      clearInterval(interval);
      pm2.disconnect();
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
    });
  });
};
