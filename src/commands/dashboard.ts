import { launchDashboard } from '../tui/launch-dashboard.js';
import { Logger } from '../utils/logger.js';

/**
 * dm dashboard  — launches the Ink-based operational dashboard.
 * Replaces the old bare-poll dm monit with a k9s-style two-pane TUI.
 */
export const dashboard = async (): Promise<void> => {
  try {
    await launchDashboard();
  } catch (err: any) {
    Logger.error('Dashboard error:', err);
    process.exit(1);
  }
};
