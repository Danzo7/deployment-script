import { launchDbCompare } from '../tui/pages/DbMigration/launch.js';

export async function dbCompare(args: { name: string }): Promise<void> {
  await launchDbCompare(args.name);
}
