/**
 * dm monit — launches the operational dashboard (alias for dashboard command).
 * This used to be a simple PM2 polling monitor but is now the full TUI dashboard.
 */
export async function monit(): Promise<void> {
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');

  await launchPage({
    pageId: PageId.Dashboard,
    params: {},
    fullScreen: true,
  });
}
