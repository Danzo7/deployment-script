import { launchDbMigrate } from '../tui/pages/DbMigration/launch.js';

export async function dbMigrate(args: {
  name: string;
  key: string;
  type?: 'generated' | 'manual';
}): Promise<void> {
  await launchDbMigrate(args);
}
