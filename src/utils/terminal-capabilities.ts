/**
 * terminal-capabilities.ts
 *
 * Detects whether the terminal can render emoji / non-BMP Unicode glyphs.
 *
 * On legacy Windows conhost (e.g. Windows Server 2016, build 14393) emoji
 * render as blank boxes regardless of chcp or font settings — it's a hard
 * rendering limitation of that OS component. Windows Terminal (WT_SESSION)
 * and anything running on build ≥ 17763 (Windows 10 1809 / Server 2019)
 * has proper font-fallback and renders emoji correctly.
 */

import os from 'os';

function windowsBuild(): number {
  if (process.platform !== 'win32') return 0;
  // os.release() on Windows returns e.g. "10.0.14393"
  const parts = os.release().split('.');
  return parseInt(parts[2] ?? '0', 10);
}

function detectSupportsUnicode(): boolean {
  // Windows Terminal — always has emoji font fallback
  if (process.env.WT_SESSION) return true;
  // VSCode integrated terminal or other known-good hosts on Windows
  if (process.platform === 'win32' && process.env.TERM_PROGRAM) return true;
  // Plain Windows: only builds ≥ 17763 have reliable emoji rendering in conhost
  if (process.platform === 'win32') return windowsBuild() >= 17763;
  // Linux / macOS — always capable
  return true;
}

/** True when the terminal can render emoji and non-BMP Unicode glyphs. */
export const supportsUnicode: boolean = detectSupportsUnicode();
