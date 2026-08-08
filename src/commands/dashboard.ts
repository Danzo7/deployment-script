import { launchDashboard } from '../tui/launch-dashboard.js';

/**
 * dm dashboard  — launches the Ink-based operational dashboard.
 * Replaces the old bare-poll dm monit with a k9s-style two-pane TUI.
 */
export const dashboard = async (): Promise<void> => {
  try {
    await launchDashboard();
  } catch (err: any) {
    throw new Error(`Dashboard error: ${err?.message ?? err}`);
  }
};
