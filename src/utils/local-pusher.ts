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
  PushSnapshot,
} from './domain-push-utils.js';

/**
 * Local Nginx pusher - uses filesystem operations and local command execution
 */
export class LocalPusher extends NginxPusher {
  /**
   * Capture snapshot of existing files for rollback
   */
  protected async captureSnapshot(): Promise<PushSnapshot> {
    const configPath = constructSitesAvailablePath(this.domain.name);
    const symlinkPath = constructSitesEnabledPath(this.domain.name);
    
    const snapshot: PushSnapshot = {
      configFile: captureFileSnapshot(configPath),
      symlink: captureFileSnapshot(symlinkPath)
    };
    
    if (this.shouldCopyCerts() && CERT_DIR) {
      const certPath = path.join(CERT_DIR, this.domain.name, 'cert.pem');
      const keyPath = path.join(CERT_DIR, this.domain.name, 'key.pem');
      snapshot.certs = {
        cert: captureFileSnapshot(certPath),
        key: captureFileSnapshot(keyPath)
      };
    }
    
    return snapshot;
  }

  /**
   * Copy config file to sites-available
   */
  private copyConfigFile(): void {
    const targetPath = constructSitesAvailablePath(this.domain.name);
    const targetDir = path.dirname(targetPath);
    
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(this.compiledConfigPath, targetPath);
  }

  /**
   * Copy SSL certs if applicable
   */
  private copyCertsIfApplicable(): void {
    if (!this.shouldCopyCerts() || !CERT_DIR) return;
    
    const certPath = this.domain.ssl.certPath!;
    const keyPath = this.domain.ssl.keyPath!;
    const targetDir = path.join(CERT_DIR, this.domain.name);
    
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(certPath, path.join(targetDir, 'cert.pem'));
    fs.copyFileSync(keyPath, path.join(targetDir, 'key.pem'));
  }

  /**
   * Create symlink in sites-enabled
   */
  private createSymlink(): void {
    const sourcePath = constructSitesAvailablePath(this.domain.name);
    const targetPath = constructSitesEnabledPath(this.domain.name);
    const targetDir = path.dirname(targetPath);
    
    fs.mkdirSync(targetDir, { recursive: true });
    
    // Remove existing symlink if present
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
    const configPath = constructSitesAvailablePath(this.domain.name);
    DomainRepo.update(this.domain.name, {
      lastPushedAt: toISO(),
      configPath: configPath
    });
  }

  /**
   * Rollback to previous state
   */
  protected async rollback(snapshot: PushSnapshot): Promise<void> {
    try {
      // Remove newly written config file
      const configPath = constructSitesAvailablePath(this.domain.name);
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
      
      // Restore previous config if it existed
      if (snapshot.configFile.existed && snapshot.configFile.content) {
        fs.writeFileSync(configPath, snapshot.configFile.content);
      }
      
      // Remove newly created symlink
      const symlinkPath = constructSitesEnabledPath(this.domain.name);
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
      
      // Restore previous symlink if it existed
      if (snapshot.symlink.existed && snapshot.symlink.isSymlink && snapshot.symlink.target) {
        fs.symlinkSync(snapshot.symlink.target, symlinkPath);
      }
      
      // Remove cert files if they were copied
      if (snapshot.certs && CERT_DIR) {
        const certPath = path.join(CERT_DIR, this.domain.name, 'cert.pem');
        const keyPath = path.join(CERT_DIR, this.domain.name, 'key.pem');
        
        if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
        if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
        
        // Restore previous certs if they existed
        if (snapshot.certs.cert.existed && snapshot.certs.cert.content) {
          fs.writeFileSync(certPath, snapshot.certs.cert.content);
        }
        if (snapshot.certs.key.existed && snapshot.certs.key.content) {
          fs.writeFileSync(keyPath, snapshot.certs.key.content);
        }
      }
      
      // Validate reverted config
      try {
        execSync('sudo nginx -t', { stdio: 'pipe' });
        Logger.info('Rollback completed successfully. Nginx config restored to previous state.');
      } catch (err: any) {
        const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
        throw new Error(
          `CRITICAL: Rollback failed and Nginx state may be inconsistent. Manual intervention required. Error: ${output}`
        );
      }
    } catch (err: any) {
      if (err.message.startsWith('CRITICAL:')) {
        throw err;
      }
      throw new Error(
        `CRITICAL: Rollback failed and Nginx state may be inconsistent. Manual intervention required. Error: ${err.message}`
      );
    }
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
