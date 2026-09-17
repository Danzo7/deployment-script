import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { PageId, PageParamsMap, PageEntry } from './types.js';

export interface NavigationApi {
  stack: PageEntry[];
  current: PageEntry;
  push<P extends PageId>(
    id: P,
    params: PageParamsMap[P],
    opts?: {
      fullScreen?: boolean;
      onResult?: (result: unknown) => void;
    }
  ): void;
  pop(result?: unknown): void;
  replace<P extends PageId>(id: P, params: PageParamsMap[P]): void;
}

const NavigationContext = createContext<NavigationApi | null>(null);

let globalNavigation: NavigationApi | null = null;
// Queue of callbacks waiting for the previous page to signal it's ready
let pageReadyCallbacks: Array<() => void> = [];

export function getNavigation(): NavigationApi {
  if (!globalNavigation) {
    throw new Error('Navigation not initialized');
  }
  return globalNavigation;
}

/**
 * Called by pages (e.g., ReplPage) after they've mounted and set up their
 * Logger sink. This triggers all queued onResult callbacks that were waiting
 * for the page to be ready to receive Logger output.
 */
export function notifyPageReady(): void {
  const callbacks = [...pageReadyCallbacks];
  pageReadyCallbacks = [];
  callbacks.forEach(cb => cb());
}

export function useNavigation(): NavigationApi {
  const nav = useContext(NavigationContext);
  if (!nav) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return nav;
}

interface NavigationProviderProps {
  initialStack: PageEntry[];
  onEmpty: () => void;
  onFinalResult?: (result: unknown) => void;
  children: ReactNode;
}

export function NavigationProvider({ initialStack, onEmpty, onFinalResult, children }: NavigationProviderProps) {
  // Store stack in React state so changes trigger re-renders
  const [stack, setStack] = useState<PageEntry[]>(initialStack);

  const push = useCallback<NavigationApi['push']>(
    (id, params, opts = {}) => {
      setStack(prevStack => [
        ...prevStack,
        {
          id,
          params,
          fullScreen: opts.fullScreen ?? false,
          onResult: opts.onResult,
        } as PageEntry,
      ]);
    },
    []
  );

  const pop = useCallback(
    (result?: unknown) => {
      setStack(prevStack => {
        if (prevStack.length === 0) return prevStack;
        
        const current = prevStack[prevStack.length - 1];
        const newStack = prevStack.slice(0, -1);
        
        // If stack is becoming empty, capture result for CLI case
        if (newStack.length === 0) {
          if (onFinalResult) {
            onFinalResult(result);
          }
          onEmpty();
        }
        // Otherwise, queue onResult for the previous page (REPL case)
        else if (current.onResult) {
          pageReadyCallbacks.push(() => current.onResult!(result));
        }
        
        return newStack;
      });
    },
    [onEmpty, onFinalResult]
  );

  const replace = useCallback<NavigationApi['replace']>(
    (id, params) => {
      setStack(prevStack => {
        if (prevStack.length === 0) return prevStack;
        const fullScreen = prevStack[prevStack.length - 1].fullScreen;
        return [...prevStack.slice(0, -1), { id, params, fullScreen } as PageEntry];
      });
    },
    []
  );

  const current = stack[stack.length - 1];

  const api: NavigationApi = {
    stack,
    current,
    push,
    pop,
    replace,
  };

  // Set global navigation
  globalNavigation = api;

  return <NavigationContext.Provider value={api}>{children}</NavigationContext.Provider>;
}
