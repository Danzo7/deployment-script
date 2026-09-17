export async function dbCompare(args: { name: string }): Promise<void> {
  const { getNavigation } = await import('../app/navigation/navigation-context.js');
  const { PageId } = await import('../app/navigation/types.js');
  
  getNavigation().push(
    PageId.DbCompare,
    { dbName: args.name },
    { fullScreen: true }
  );
}
