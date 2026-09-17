/**
 * Unified launcher utility for interactive TUI pages.
 * 
 * Handles the boilerplate of checking for navigation context and branching
 * between REPL (navigation.push) and CLI (bootstrapApp) execution paths.
 * 
 * This eliminates code duplication across all interactive command handlers.
 */

import type { PageId } from './types.js';

export interface LaunchPageOptions<TResult = unknown> {
  /** Page ID to launch */
  pageId: PageId;
  
  /** Parameters to pass to the page */
  params: any;
  
  /** Whether to use full-screen alt-screen buffer */
  fullScreen: boolean;
  
  /** Optional callback to handle the result when page exits */
  onResult?: (result: TResult) => void;
}

/**
 * Launch a TUI page in either REPL or CLI context.
 * 
 * - In REPL: pushes page to navigation stack with onResult callback
 * - In CLI: bootstraps app directly and calls onResult after exit
 * 
 * @example
 * ```ts
 * await launchPage({
 *   pageId: PageId.EnvEditor,
 *   params: { appName: 'myapp' },
 *   fullScreen: true,
 *   onResult: (savedCount) => {
 *     if (savedCount > 0) {
 *       Logger.success(`Saved ${savedCount} changes`);
 *     }
 *   },
 * });
 * ```
 */
export async function launchPage<TResult = unknown>(
  options: LaunchPageOptions<TResult>
): Promise<void> {
  const { pageId, params, fullScreen, onResult } = options;
  
  // Try to get navigation (works inside REPL/Ink tree)
  let nav = null;
  try {
    const { getNavigation } = await import('./navigation-context.js');
    nav = getNavigation();
  } catch {
    // Navigation not available - will bootstrap directly
  }
  
  if (nav) {
    // REPL case: push page with onResult callback
    nav.push(pageId, params, { 
      fullScreen, 
      onResult: onResult as ((result: unknown) => void) | undefined,
    });
  } else {
    // CLI case: bootstrap app directly and handle result after it exits
    const { bootstrapApp } = await import('../root.js');
    const result = await bootstrapApp({
      id: pageId,
      params,
      fullScreen,
    });
    
    // Execute result handler if provided
    if (onResult) {
      onResult(result as TResult);
    }
  }
}
