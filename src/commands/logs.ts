import pm2 from 'pm2';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import {
  openSharedPm2,
  closeSharedPm2,
  readAppLogs,
} from '../utils/pm2-helper.js';
import type { StreamingRunner } from '../app/navigation/types.js';

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
          resolve();
        };

        sigtermHandler = () => {
          cleanup();
          resolve();
        };

        process.on('SIGINT', sigintHandler);
        process.on('SIGTERM', sigtermHandler);

        // Never resolve - keep streaming until interrupted
      });
    });
  } catch (err) {
    cleanup();
    throw err;
  }
};

// ─── Streaming runner for new navigation architecture ─────────────────────────

export function createLogsRunner({ name }: { name: string }): StreamingRunner {
  return {
    start: (emit) => {
      let bus: any = null;
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        
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

      const init = async () => {
        try {
          await AppRepo.findByName(name);
          await openSharedPm2();

          // Print historical logs
          const historicalLogs = await readAppLogs(name, 100);
          for (const line of historicalLogs) {
            emit(line);
          }

          // Stream live logs via PM2 bus
          await new Promise<void>((resolve, reject) => {
            pm2.launchBus((busErr, busInstance) => {
              if (busErr) {
                return reject(busErr);
              }

              bus = busInstance;

              emit(
                `\x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m \x1b[36mℹ\x1b[0m Streaming logs for "\x1b[1m\x1b[36m${name}\x1b[0m" (Ctrl+C to stop)...\n`
              );

              bus.on('log:out', (packet: any) => {
                if (packet.process?.name === name) {
                  emit(`[${packet.process.name}] ${packet.data}`);
                }
              });

              bus.on('log:err', (packet: any) => {
                if (packet.process?.name === name) {
                  emit(`[${packet.process.name}][err] ${packet.data}`);
                }
              });

              bus.on('process:exception', (packet: any) => {
                if (packet.process?.name === name) {
                  emit(
                    `[${packet.process.name}][exception] ${JSON.stringify(packet.data)}`
                  );
                }
              });
            });
          });
        } catch (err: any) {
          emit(`\x1b[31m✖\x1b[0m ${err?.message ?? String(err)}`);
          cleanup();
        }
      };

      init();

      return cleanup;
    },
  };
}


/**
 * Launches the logs streaming view.
 * Works in both REPL (navigation push) and CLI (direct bootstrapApp) contexts.
 */
export async function launchLogs(name: string): Promise<void> {
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');
  
  await launchPage({
    pageId: PageId.StreamingOutput,
    params: {
      title: `logs: ${name}`,
      run: createLogsRunner({ name }),
    },
    fullScreen: false,
  });
}
