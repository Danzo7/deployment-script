import type { Interface } from 'node:readline';

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
 *
 * Critical ownership boundary:
 * - pauseRepl() ONLY closes readline, letting readline relinquish stdin control
 * - Ink then owns stdin in raw mode during TUI rendering
 * - resumeRepl() ONLY creates a new readline, letting it establish stdin state
 * - Neither function manually manipulates stdin's flowing/raw state to avoid races
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

  const rl = activeRl;
  activeRl = null;

  rl.close();

  // After rl.close(), readline leaves stdin in a paused state.
  // We need to resume it so Ink can read from stdin.
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
}

export async function resumeRepl(): Promise<void> {
  if (!rlFactory) {
    handingOff = false;
    return;
  }

  // Let Ink finish its terminal/stdin cleanup.
  await new Promise<void>((resolve) => setImmediate(resolve));

  // The factory will handle stdin state setup
  const rl = rlFactory();

  activeRl = rl;
  handingOff = false;

  // Clear the line and show the prompt with a hint
  process.stdout.write('\n\r\x1b[K');
  process.stdout.write('\x1b[90m(Press Enter to continue)\x1b[0m\n');
  rl.prompt();
}
