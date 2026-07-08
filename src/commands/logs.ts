import pm2 from 'pm2';
import fs from 'fs';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

/** Read the last `lines` lines of a file, or empty string if unavailable. */
function readTail(filePath: string | undefined, lines = 100): string {
  if (!filePath) return '';
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const all = content.split('\n').filter(Boolean);
    return all.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export const logs = async ({ name }: { name: string }) => {
  await AppRepo.findByName(name);

  // ── Print historical logs from file before streaming ──────────────────────
  await new Promise<void>((resolve) => {
    pm2.connect((connectErr) => {
      if (connectErr) return resolve();
      pm2.describe(name, (descErr, list) => {
        pm2.disconnect();
        if (descErr || !list?.length) return resolve();
        const env = list[0].pm2_env as any;
        const outTail = readTail(env?.pm_out_log_path, 100);
        const errTail = readTail(env?.pm_err_log_path, 100);
        if (outTail) process.stdout.write(outTail + '\n');
        if (errTail) process.stderr.write(errTail + '\n');
        resolve();
      });
    });
  });

  // ── Stream live logs via PM2 bus ──────────────────────────────────────────
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
