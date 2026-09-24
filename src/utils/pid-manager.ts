// ─── PID File Manager ─────────────────────────────────────────────────────────
//
// Manages PID files for the remote server daemon to prevent multiple instances
// and allow process tracking.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

export class PidManager {
  private pidFilePath: string;

  constructor(pidFilePath: string) {
    this.pidFilePath = pidFilePath;
  }

  /**
   * Write the current process PID to file
   */
  writePid(pid?: number): void {
    const actualPid = pid ?? process.pid;
    const dir = path.dirname(this.pidFilePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(this.pidFilePath, String(actualPid), { mode: 0o600 });
  }

  /**
   * Read PID from file
   */
  readPid(): number | null {
    if (!fs.existsSync(this.pidFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.pidFilePath, 'utf8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Remove PID file
   */
  removePid(): void {
    if (fs.existsSync(this.pidFilePath)) {
      try {
        fs.unlinkSync(this.pidFilePath);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Check if the PID in the file is still running
   */
  isProcessRunning(): boolean {
    const pid = this.readPid();
    if (!pid) return false;

    try {
      // Signal 0 doesn't kill the process, just checks if it exists
      process.kill(pid, 0);
      return true;
    } catch {
      // Process doesn't exist or we don't have permission
      return false;
    }
  }

  /**
   * Check if PID file is valid (exists and process is running)
   */
  isValid(): boolean {
    return this.isProcessRunning();
  }

  /**
   * Clean up stale PID file (exists but process not running)
   */
  cleanStale(): void {
    const pid = this.readPid();
    if (pid && !this.isProcessRunning()) {
      this.removePid();
    }
  }
}
