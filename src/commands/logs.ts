import pm2 from 'pm2';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { openSharedPm2, closeSharedPm2, readAppLogs } from '../utils/pm2-helper.js';

export const logs = async ({ name }: { name: string }) => {
  await AppRepo.findByName(name);

  try {
    // Open persistent connection
    await openSharedPm2();

    // Print historical logs
    const historicalLogs = await readAppLogs(name, 100);
    for (const line of historicalLogs) {
      if (line.includes('[err]')) {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    }

    // Stream live logs via PM2 bus
    await new Promise<void>((resolve, reject) => {
      pm2.launchBus((busErr, bus) => {
        if (busErr) {
          return reject(busErr);
        }

        Logger.info(`Streaming logs for "${Logger.highlight(name)}" (Ctrl+C to stop)...\n`);

        bus.on('log:out', (packet: any) => {
          if (packet.process?.name === name) {
            process.stdout.write(`[${packet.process.name}] ${packet.data}\n`);
          }
        });

        bus.on('log:err', (packet: any) => {
          if (packet.process?.name === name) {
            process.stderr.write(`[${packet.process.name}][err] ${packet.data}\n`);
          }
        });

        bus.on('process:exception', (packet: any) => {
          if (packet.process?.name === name) {
            process.stderr.write(`[${packet.process.name}][exception] ${JSON.stringify(packet.data)}\n`);
          }
        });

        const cleanup = () => {
          try { bus.close(); } catch { /* ignore */ }
          closeSharedPm2();
          resolve();
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      });
    });
  } catch (err) {
    closeSharedPm2();
    Logger.error('Failed to stream logs:', err);
    process.exit(1);
  }
};
