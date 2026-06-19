import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { NginxPusher } from './nginx-pusher.js';
import { DomainRepo } from '../db/repos.js';
import { CERT_DIR } from '../constants.js';
import { Logger } from './logger.js';
import { toISO } from './date-helper.js';
import {
  constructSitesAvailablePath,
  constructSitesEnabledPath,
  captureFileSnapshot,
  buildRollbackTargets,
  PushSnapshot,
  RollbackTarget,
} from './domain-push-utils.js';

/**
 * Local Nginx pusher - uses filesystem operations and local command execution
 */
export class LocalPusher extends NginxPusher {
  private get localCertPath(): string | undefined {
    if (!this.shouldCopyCerts() || !CERT_DIR) return undefined;
    return path.join(CERT_DIR, this.domain.name, 'cert.pem');
  }

  private get localKeyPath(): string | undefined {
    if (!this.shouldCopyCerts() || !CERT_DIR) return undefined;
    return path.join(CERT_DIR, this.domain.name, 'key.pem');
  }

  /**
   * Capture snapshot of existing files for rollback
   */
  protected async captureSnapshot(): Promise<PushSnapshot> {
    const configPath = constructSitesAvailablePath(this.domain.name);
    const symlinkPath = constructSitesEnabledPath(this.domain.name);

    const snapshot: PushSnapshot = {
      configFile: captureFileSnapshot(configPath),
      symlink: captureFileSnapshot(symlinkPath),
    };

    if (this.localCertPath && this.localKeyPath) {
      snapshot.certs = {
        cert: captureFileSnapshot(this.localCertPath),
        key: captureFileSnapshot(this.localKeyPath),
      };
    }

    return snapshot;
  }

  /**
   * Copy config file to sites-available
   */
  private copyConfigFile(): void {
    const targetPath = constructSitesAvailablePath(this.domain.name);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(this.compiledConfigPath, targetPath);
  }

  /**
   * Copy SSL certs if applicable
   */
  private copyCertsIfApplicable(): void {
    if (!this.localCertPath || !this.localKeyPath) return;

    const certPath = this.domain.ssl.certPath!;
    const keyPath = this.domain.ssl.keyPath!;

    fs.mkdirSync(path.dirname(this.localCertPath), { recursive: true });
    fs.copyFileSync(certPath, this.localCertPath);
    fs.copyFileSync(keyPath, this.localKeyPath);
  }

  /**
   * Create symlink in sites-enabled
   */
  private createSymlink(): void {
    const sourcePath = constructSitesAvailablePath(this.domain.name);
    const targetPath = constructSitesEnabledPath(this.domain.name);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.symlinkSync(sourcePath, targetPath);
  }

  /**
   * Validate nginx config
   */
  private validateNginx(): void {
    try {
      execSync('sudo nginx -t', { stdio: 'pipe' });
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
      throw this.formatError('validate nginx config', 'local', err, output);
    }
  }

  /**
   * Reload nginx
   */
  private reloadNginx(): void {
    try {
      execSync('sudo nginx -s reload', { stdio: 'pipe' });
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
      throw this.formatError('reload nginx', 'local', err, output);
    }
  }

  /**
   * Update domain metadata
   */
  private updateMetadata(): void {
    DomainRepo.update(this.domain.name, {
      lastPushedAt: toISO(),
      configPath: constructSitesAvailablePath(this.domain.name),
    });
  }

  /**
   * Restore a single rollback target on the local filesystem.
   */
  private restoreTarget(target: RollbackTarget): void {
    if (fs.existsSync(target.path)) {
      fs.unlinkSync(target.path);
    }

    if (!target.snapshot.existed) return;

    if (target.snapshot.isSymlink && target.snapshot.target) {
      fs.symlinkSync(target.snapshot.target, target.path);
      return;
    }

    if (target.snapshot.content) {
      fs.writeFileSync(target.path, target.snapshot.content);
    }
  }

  /**
   * Rollback to previous state. Each target is restored independently so
   * one failure doesn't prevent the others from being attempted; all
   * failures are collected and reported together.
   */
  protected async rollback(snapshot: PushSnapshot): Promise<void> {
    const targets = buildRollbackTargets(snapshot, {
      configPath: constructSitesAvailablePath(this.domain.name),
      symlinkPath: constructSitesEnabledPath(this.domain.name),
      certPath: this.localCertPath,
      keyPath: this.localKeyPath,
    });

    const failures: string[] = [];
    for (const target of targets) {
      try {
        this.restoreTarget(target);
      } catch (err: any) {
        failures.push(`${target.label} (${target.path}): ${err.message}`);
      }
    }

    let validationError: string | undefined;
    try {
      execSync('sudo nginx -t', { stdio: 'pipe' });
    } catch (err: any) {
      validationError = err.stderr?.toString() || err.stdout?.toString() || err.message;
    }

    if (failures.length === 0 && !validationError) {
      Logger.info('Rollback completed successfully. Nginx config restored to previous state.');
      return;
    }

    const parts = [
      ...failures.map((f) => `- failed to restore ${f}`),
      ...(validationError ? [`- nginx -t failed after rollback: ${validationError}`] : []),
    ];
    throw new Error(
      `CRITICAL: Rollback failed and Nginx state may be inconsistent. Manual intervention required.\n${parts.join('\n')}`
    );
  }

  /**
   * Execute the push operation
   */
  async push(): Promise<void> {
    const snapshot = await this.captureSnapshot();

    try {
      this.copyConfigFile();
      this.copyCertsIfApplicable();
      this.createSymlink();
      this.validateNginx();
      this.reloadNginx();
      this.updateMetadata();
    } catch (err) {
      await this.rollback(snapshot);
      throw err;
    }
  }
}
