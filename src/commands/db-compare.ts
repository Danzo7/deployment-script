export async function dbCompare(args: { name: string }): Promise<void> {
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');

  await launchPage({
    pageId: PageId.DbCompare,
    params: { dbName: args.name },
    fullScreen: true,
  });
}
