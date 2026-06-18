import * as fs from 'fs';
import * as path from 'path';
import { createTwoFilesPatch } from 'diff';
import { resolveNginxConfig } from '../utils/nginx-compiler.js';
import { Logger } from '../utils/logger.js';
import { DOMAINS_DIR } from '../constants.js';

export async function domainCompile(name: string): Promise<void> {
  const { config, domainName, wwwSanWarning, wwwConflictInfo } = resolveNginxConfig(name);

  if (wwwSanWarning) Logger.warn(wwwSanWarning);
  if (wwwConflictInfo) Logger.info(wwwConflictInfo);

  const outputDir = path.join(DOMAINS_DIR, domainName);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'nginx.conf');

  let previousContent: string | undefined;
  try {
    previousContent = fs.readFileSync(outputPath, 'utf8');
  } catch {
    previousContent = undefined;
  }

  if (previousContent !== undefined) {
    const diff = createTwoFilesPatch(outputPath, outputPath, previousContent, config);
    const hasChanges = diff.split('\n').some((line) => line.startsWith('@@'));
    if (!hasChanges) {
      Logger.info(`nginx.conf is unchanged for ${name}`);
    } else {
      process.stdout.write(diff);
    }
  } else {
    process.stdout.write(config);
  }

  fs.writeFileSync(outputPath, config, 'utf8');
  Logger.success(outputPath);
}
