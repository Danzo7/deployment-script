import pm2 from 'pm2';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export const logs = ({ name }: { name: string }) => {
  const app = AppRepo.getAll().find((a) => a.name === name);
  if (!app) throw new Error(`App "${Logger.highlight(name)}" not found.`);

  pm2.connect((connectErr) => {
    if (connectErr) {
      Logger.error('Failed to connect to pm2:', connectErr);
      process.exit(1);
    }

    pm2.launchBus((busErr, bus) => {
      if (busErr) {
        pm2.disconnect();
        Logger.error('Failed to launch pm2 bus:', busErr);
        process.exit(1);
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

      process.on('SIGINT', () => {
        bus.close();
        pm2.disconnect();
        process.exit(0);
      });
    });
  });
};
