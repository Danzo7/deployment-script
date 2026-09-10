import { launchDashboard } from "../tui/launch-dashboard.js";
const dashboard = async () => {
  try {
    await launchDashboard();
  } catch (err) {
    throw new Error(`Dashboard error: ${err?.message ?? err}`);
  }
};
export {
  dashboard
};
