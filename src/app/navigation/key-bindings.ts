import { useInput } from 'ink';
import { usePageExit } from './use-page-exit.js';

export function useExitKeyBinding(): void {
  const exit = usePageExit();
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });
}
