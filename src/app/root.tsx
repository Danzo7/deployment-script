import { render } from 'ink';
import React from 'react';
import { NavigationProvider } from './navigation/navigation-context.js';
import { PageHost } from './layout/page-host.js';
import type { PageId, PageParamsMap, PageEntry } from './navigation/types.js';

export async function bootstrapApp<P extends PageId>(initial: {
  id: P;
  params: PageParamsMap[P];
  fullScreen?: boolean;
}): Promise<unknown> {
  const initialStack: PageEntry[] = [{
    id: initial.id,
    params: initial.params,
    fullScreen: initial.fullScreen ?? false,
  }];

  let unmountFn: (() => void) | null = null;
  let finalResult: unknown = undefined;

  const onEmpty = () => {
    if (unmountFn) {
      unmountFn();
    }
  };

  const { waitUntilExit, unmount } = render(
    <NavigationProvider 
      initialStack={initialStack} 
      onEmpty={onEmpty}
      onFinalResult={(result) => { finalResult = result; }}
    >
      <PageHost />
    </NavigationProvider>,
    {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      exitOnCtrlC: false,
    }
  );

  unmountFn = unmount;

  await waitUntilExit();
  
  // Return the result captured from the final page pop
  return finalResult;
}
