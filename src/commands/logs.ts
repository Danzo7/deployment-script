import pm2 from 'pm2';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import {
  openSharedPm2,
  closeSharedPm2,
  readAppLogs,
} from '../utils/pm2-helper.js';

export const logs = async ({ name }: { name: string }) => {
  await AppRepo.findByName(name);

  let bus: any = null;
  let sigintHandler: (() => void) | null = null;
  let sigtermHandler: (() => void) | null = null;

  const cleanup = () => {
    if (sigintHandler) {
      process.removeListener('SIGINT', sigintHandler);
      sigintHandler = null;
    }
    if (sigtermHandler) {
      process.removeListener('SIGTERM', sigtermHandler);
      sigtermHandler = null;
    }
    if (bus) {
      try {
        bus.close();
      } catch {
        /* ignore */
      }
      bus = null;
    }
    closeSharedPm2();
  };

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
      pm2.launchBus((busErr, busInstance) => {
        if (busErr) {
          return reject(busErr);
        }

        bus = busInstance;

        Logger.info(
          `Streaming logs for "${Logger.highlight(name)}" (Ctrl+C to stop)...\n`
        );

        bus.on('log:out', (packet: any) => {
          if (packet.process?.name === name) {
            process.stdout.write(`[${packet.process.name}] ${packet.data}\n`);
          }
        });

        bus.on('log:err', (packet: any) => {
          if (packet.process?.name === name) {
            process.stderr.write(
              `[${packet.process.name}][err] ${packet.data}\n`
            );
          }
        });

        bus.on('process:exception', (packet: any) => {
          if (packet.process?.name === name) {
            process.stderr.write(
              `[${packet.process.name}][exception] ${JSON.stringify(packet.data)}\n`
            );
          }
        });

        sigintHandler = () => {
          cleanup();
          process.exit(0);
        };

        sigtermHandler = () => {
          cleanup();
          process.exit(0);
        };

        process.on('SIGINT', sigintHandler);
        process.on('SIGTERM', sigtermHandler);

        // Never resolve - keep streaming until interrupted
      });
    });
  } catch (err) {
    cleanup();
    Logger.error('Failed to stream logs:', err);
    process.exit(1);
  }
};
