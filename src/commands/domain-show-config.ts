import { resolveNginxConfig } from '../utils/nginx-compiler.js';
import { Logger } from '../utils/logger.js';

export async function domainShowConfig(name: string): Promise<void> {
  const { config, wwwSanWarning, wwwConflictInfo } = resolveNginxConfig(name);

  if (wwwSanWarning) Logger.warn(wwwSanWarning);
  if (wwwConflictInfo) Logger.info(wwwConflictInfo);

  process.stdout.write(config);
}
