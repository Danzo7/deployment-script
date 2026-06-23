import * as fs from 'fs';
import * as path from 'path';
import { resolveNginxConfig } from '../utils/nginx-compiler.js';
import { Logger } from '../utils/logger.js';
import { DOMAINS_DIR } from '../constants.js';

export async function domainCompile(name: string): Promise<void> {
  const { config, domainName, wwwSanWarning, wwwConflictInfo } = await resolveNginxConfig(name);

  if (wwwSanWarning) Logger.warn(wwwSanWarning);
  if (wwwConflictInfo) Logger.info(wwwConflictInfo);

  const outputDir = path.join(DOMAINS_DIR, domainName);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'nginx.conf');
  fs.writeFileSync(outputPath, config, 'utf8');
  Logger.success(`Config compiled: ${outputPath}`);
}
