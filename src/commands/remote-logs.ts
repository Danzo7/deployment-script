// ─── Remote Logs Command ──────────────────────────────────────────────────────
//
// Display logs from the remote server daemon.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { Logger } from '../utils/logger.js';
import { REMOTE_PID_FILE_PATH } from '../constants.js';

/**
 * Show remote server logs
 */
export async function remoteLogs(follow = false, lines = 50): Promise<void> {
  const logDir = path.join(path.dirname(REMOTE_PID_FILE_PATH), 'logs');
  const logFile = path.join(logDir, 'dm-remote.log');

  if (!fs.existsSync(logFile)) {
    Logger.warn('No log file found');
    Logger.info(`  Log file: ${chalk.gray(logFile)}`);
    Logger.info(`  Logs are only available when running in daemon mode`);
    return;
  }

  if (follow) {
    Logger.info(chalk.cyan(`Following logs from ${logFile}`));
    Logger.info(chalk.gray('Press Ctrl+C to exit'));
    Logger.nl();

    // Use tail -f equivalent
    if (process.platform === 'win32') {
      // Windows: use PowerShell Get-Content -Wait
      const ps = spawn(
        'powershell',
        ['-Command', `Get-Content -Path "${logFile}" -Wait -Tail ${lines}`],
        { stdio: 'inherit' }
      );

      process.on('SIGINT', () => {
        ps.kill();
        process.exit(0);
      });
    } else {
      // Unix: use tail -f
      const tail = spawn('tail', ['-f', '-n', String(lines), logFile], {
        stdio: 'inherit',
      });

      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    }
  } else {
    // Just show last N lines
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split('\n');
    const recentLines = allLines.slice(-lines);

    Logger.info(chalk.cyan(`Last ${lines} lines from ${logFile}:`));
    Logger.nl();

    for (const line of recentLines) {
      if (line.trim()) {
        console.log(line);
      }
    }
  }
}
