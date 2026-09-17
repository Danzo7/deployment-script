import type { DashboardAction } from '../tui/pages/Dashboard/types.js';

/**
 * dm dashboard  — launches the Ink-based operational dashboard.
 * Replaces the old bare-poll dm monit with a k9s-style two-pane TUI.
 */
export const dashboard = async (): Promise<void> => {
  const { openSharedPm2, closeSharedPm2 } = await import('../utils/pm2-helper.js');
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');
  const { Logger } = await import('../utils/logger.js');
  const { disconnectSharedSsh, resetTailers } = await import('../utils/dashboard-data.js');

  try {
    await openSharedPm2();
  } catch {
    /* dashboard will show pm2 unreachable */
  }

  await launchPage({
    pageId: PageId.Dashboard,
    params: {},
    fullScreen: true,
    onResult: async (result: unknown) => {
      closeSharedPm2();
      disconnectSharedSsh();
      resetTailers();

      const action = result as DashboardAction | undefined;
      if (!action) return;

      console.log();

      switch (action.type) {
        case 'restart': {
          const { restart } = await import('./restart.js');
          await restart({ name: action.appName });
          break;
        }
        case 'stop': {
          const { stop } = await import('./stop.js');
          await stop({ name: action.appName });
          break;
        }
        case 'deploy': {
          Logger.info(`To deploy: dm deploy ${action.appName}`);
          break;
        }
        case 'rollback': {
          const { rollback } = await import('./rollback.js');
          await rollback({ name: action.appName, to: action.rollbackIndex });
          break;
        }
        case 'logs': {
          const { launchLogs } = await import('./logs.js');
          await launchLogs(action.appName);
          break;
        }
        case 'env': {
          // Use the shared launch function which handles onResult
          const { launchEnvEditorForApp } = await import('./set-env.js');
          await launchEnvEditorForApp(action.appName);
          break;
        }
        default:
          break;
      }
    },
  });
};
