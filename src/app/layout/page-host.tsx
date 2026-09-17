import React, { useEffect } from 'react';
import { useNavigation } from '../navigation/navigation-context.js';
import { useExitKeyBinding } from '../navigation/key-bindings.js';
import { useAltScreen } from './alt-screen.js';
import { PageId } from '../navigation/types.js';
import { Logger } from '../../utils/logger.js';
import { ReplPage } from '../../tui/pages/Repl/index.js';
import { StreamingOutputPage } from '../../tui/pages/StreamingOutput/index.js';
import { Dashboard } from '../../tui/pages/Dashboard/index.js';
import { EnvEditorAdapter } from '../../tui/pages/EnvEditor/EnvEditorAdapter.js';
import { RemoteServeAdapter } from '../../tui/pages/RemoteServe/RemoteServeAdapter.js';
import { DbMigrateScreen, DbCompareScreen } from '../../tui/pages/DbMigration/index.js';
import { HeaderEditorAdapter } from '../../tui/pages/HeaderEditor/HeaderEditorAdapter.js';

// Page registry - extend as pages are migrated
const PAGE_COMPONENTS: Partial<Record<PageId, React.ComponentType<any>>> = {
  [PageId.Repl]: ReplPage,
  [PageId.StreamingOutput]: StreamingOutputPage,
  [PageId.Dashboard]: Dashboard,
  [PageId.EnvEditor]: EnvEditorAdapter,
  [PageId.RemoteServe]: RemoteServeAdapter,
  [PageId.DbMigrate]: DbMigrateScreen,
  [PageId.DbCompare]: DbCompareScreen,
  [PageId.HeaderEditor]: HeaderEditorAdapter,
};

export function PageHost() {
  const nav = useNavigation();
  
  useExitKeyBinding();
  
  const current = nav.current;
  const fullScreen = current.fullScreen;
  
  // Toggle alt-screen when fullScreen changes
  // useLayoutEffect runs synchronously before child components render
  useAltScreen(fullScreen);
  
  // Logger routing based on page
  useEffect(() => {
    // Clear sink when mounting full-screen pages (default behavior)
    // Individual pages can override by setting their own sink
    if (fullScreen) {
      Logger.clearSink();
    }
  }, [current.id, fullScreen]);
  
  const PageComponent = PAGE_COMPONENTS[current.id];
  
  if (!PageComponent) {
    return <></>;
  }
  
  return <PageComponent {...current.params} />;
}
