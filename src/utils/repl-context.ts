import type { Interface } from 'readline';

/**
 * Holds a reference to the active REPL readline interface, and knows how to
 * rebuild it. TUI launchers (launch-dashboard.tsx, launch-env-editor.tsx)
 * call pauseRepl()/resumeRepl() around Ink renders.
 *
 * Why this isn't just `rl.pause()` / `rl.resume()`:
 * Node's readline interface, when attached to a TTY, keeps its own
 * 'keypress' listener bound to stdin for the lifetime of the interface —
 * `rl.pause()` stops it from emitting 'line' events, but does NOT remove
 * that listener or give stdin back in "cooked" mode in a way Ink can rely
 * on. When Ink then puts stdin in raw mode and attaches its own input
 * listener for `useInput`, both readline and Ink end up reading the same
 * keystrokes: arrow keys/enter typed inside the dashboard could leak into
 * the readline line buffer, and after the TUI exited the prompt would come
 * back garbled, or the first few keystrokes typed at `dm>` would vanish.
 *
 * The fix is to fully close the readline interface before handing stdin to
 * Ink, and build a brand new one after Ink hands it back — rather than try
 * to pause/resume the same instance. `repl.ts` registers a factory via
 * `setReplFactory` for exactly this purpose.
 */

let activeRl: Interface | null = null;
let rlFactory: (() => Interface) | null = null;
let handingOff = false;

/** Registers the active readline interface (called by repl.ts). */
export function setReplInterface(rl: Interface | null): void {
  activeRl = rl;
}

/** Returns the currently active readline interface, if any. */
export function getActiveRl(): Interface | null {
  return activeRl;
}

/**
 * Registers a factory that builds a fresh, fully-configured readline
 * interface (same prompt, same completer, same 'line'/'close' handlers).
 * Called once by repl.ts at startup.
 */
export function setReplFactory(factory: () => Interface): void {
  rlFactory = factory;
}

/**
 * True while the REPL's readline interface has been intentionally torn down
 * for a TUI handoff. repl.ts checks this in its 'close' handler so that an
 * intentional pauseRepl() close doesn't get mistaken for the user exiting
 * (e.g. Ctrl+D) and doesn't tear down the whole process.
 */
export function isHandingOff(): boolean {
  return handingOff;
}

export function pauseRepl(): void {
  if (!activeRl) return;
  handingOff = true;
  activeRl.close();
  activeRl = null;
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
}

export function resumeRepl(): void {
  handingOff = false;
  if (!rlFactory) return;
  // Ink can leave stdin paused/raw on exit; make sure it's back in normal
  // flowing "cooked" mode before we build a fresh readline interface on it.
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  process.stdin.resume();
  const rl = rlFactory();
  setReplInterface(rl);
  rl.prompt();
}
