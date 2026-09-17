import { useCallback } from 'react';
import { useNavigation } from './navigation-context.js';

export function usePageExit(): (result?: unknown) => void {
  const nav = useNavigation();
  return useCallback((result?: unknown) => nav.pop(result), [nav]);
}
