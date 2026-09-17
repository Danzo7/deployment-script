import { useLayoutEffect } from 'react';

export function useAltScreen(enabled: boolean) {
  useLayoutEffect(() => {
    if (enabled) {
      process.stdout.write('\x1b[?1049h'); // Enter alt screen
      return () => {
        process.stdout.write('\x1b[?1049l'); // Leave alt screen
      };
    }
  }, [enabled]);
}
