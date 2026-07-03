import type { Interface } from 'readline';

/**
 * Holds a reference to the active REPL readline interface.
 * TUI launchers use this to pause/resume stdin around Ink renders,
 * preventing Ink's raw-mode takeover from corrupting the REPL input.
 */
let activeRl: Interface | null = null;

export function setReplInterface(rl: Interface | null): void {
  activeRl = rl;
}

export function pauseRepl(): void {
  if (activeRl) {
    activeRl.pause();
    // Restore cooked mode so Ink can switch to raw cleanly
    if ((process.stdin as any).setRawMode) {
      (process.stdin as any).setRawMode(false);
    }
  }
}

export function resumeRepl(): void {
  if (activeRl) {
    // Ensure stdin is back in flowing mode before readline resumes
    process.stdin.resume();
    activeRl.resume();
  }
}
