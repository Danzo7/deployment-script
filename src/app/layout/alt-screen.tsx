import { useLayoutEffect } from 'react';

export function useAltScreen(enabled: boolean) {
  useLayoutEffect(() => {
    if (enabled) {
      process.stdout.write('\x1b[?1049h'); // Enter alt screen
      process.stdout.write('\x1b[H'); // Reset cursor to top-left (row 1, col 1)
      return () => {
        process.stdout.write('\x1b[?1049l'); // Leave alt screen
      };
    }
  }, [enabled]);
}
