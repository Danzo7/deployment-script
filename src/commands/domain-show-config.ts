import * as fs from 'fs';
import * as path from 'path';
import { normalizeDomainName } from '../utils/route-validation.js';
import { Logger } from '../utils/logger.js';
import { DOMAINS_DIR } from '../constants.js';

export async function domainShowConfig(name: string): Promise<void> {
  const domainName = normalizeDomainName(name);
  const configPath = path.join(DOMAINS_DIR, domainName, 'nginx.conf');

  if (!fs.existsSync(configPath)) {
    Logger.info(`No config compiled yet for ${domainName}`);
    return;
  }

  const config = fs.readFileSync(configPath, 'utf8');
  process.stdout.write(config);
}
