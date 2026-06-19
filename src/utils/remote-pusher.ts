import fs from 'fs';
import os from 'os';
import path from 'path';
import { NginxPusher } from './nginx-pusher.js';
import { DomainRepo } from '../db/repos.js';
import { PUSH_CERT_DIR } from '../constants.js';
import { Logger } from './logger.js';
import { toISO } from './date-helper.js';
import { SshConnection, SshCredentials } from './ssh-connection.js';
import {
  constructSitesAvailablePath,
  constructSitesEnabledPath,
  buildRollbackTargets,
  shellQuote,
  PushSnapshot,
  FileSnapshot,
  RollbackTarget,
} from './domain-push-utils.js';
import {
  validateSafeDomainName,
  validateCertPath,
  generateSecureTempFilename,
} from './security-validation.js';

/**
 * Remote Nginx pusher - pushes config/certs to a remote host over SSH and
 * reloads nginx there. Transport concerns (connecting, exec, sftp) live in
 * SshConnection; this class only orchestrates the push/rollback workflow.
 */
export class RemotePusher extends NginxPusher {
  private readonly ssh: SshConnection;
  private readonly remoteCertDir: string;

  constructor(
    domainName: string,
    remoteHost: string,
    sshKeyPath?: string,
    sshPassword?: string,
    sudoPassword?: string
  ) {
    super(domainName);
    
    // Validate domain name for security
    validateSafeDomainName(domainName);
    
    const creds: SshCredentials = { remoteHost, sshKeyPath, sshPassword, sudoPassword };
    this.ssh = new SshConnection(creds);
    
    // For remote deployments, use PUSH_CERT_DIR or default to /etc/nginx/ssl
    const baseCertDir = PUSH_CERT_DIR ?? '/etc/nginx/ssl';
    this.remoteCertDir = validateCertPath(baseCertDir, domainName);
  }

  /** Remote path for the SSL certificate, if certs are in play. */
  private get remoteCertPath(): string | undefined {
    if (!this.shouldCopyCerts()) return undefined;
    return toPosixPath(path.join(this.remoteCertDir, 'cert.pem'));
  }

  /** Remote path for the SSL private key, if certs are in play. */
  private get remoteKeyPath(): string | undefined {
    if (!this.shouldCopyCerts()) return undefined;
    return toPosixPath(path.join(this.remoteCertDir, 'key.pem'));
  }

  /**
   * Capture snapshot of existing remote files for rollback
   */
  protected async captureSnapshot(): Promise<PushSnapshot> {
    const configPath = constructSitesAvailablePath(this.domain.name);
    const symlinkPath = constructSitesEnabledPath(this.domain.name);

    const snapshot: PushSnapshot = {
      configFile: await this.captureRemoteFileSnapshot(configPath),
      symlink: await this.captureRemoteFileSnapshot(symlinkPath),
    };

    if (this.remoteCertPath && this.remoteKeyPath) {
      snapshot.certs = {
        cert: await this.captureRemoteFileSnapshot(this.remoteCertPath),
        key: await this.captureRemoteFileSnapshot(this.remoteKeyPath),
      };
    }

    return snapshot;
  }

  /**
   * Capture a single remote file snapshot
   */
  private async captureRemoteFileSnapshot(filePath: string): Promise<FileSnapshot> {
    const q = shellQuote(filePath);
    try {
      const checkCmd = `[ -L ${q} ] && echo "symlink" || ([ -f ${q} ] && echo "file" || echo "none")`;
      const fileType = (await this.ssh.exec(checkCmd)).trim();

      if (fileType === 'none') {
        return { path: filePath, existed: false };
      }
      if (fileType === 'symlink') {
        const target = (await this.ssh.exec(`readlink ${q}`)).trim();
        return { path: filePath, existed: true, isSymlink: true, target };
      }
      const content = await this.ssh.sftpReadFile(filePath);
      return { path: filePath, existed: true, content: content || undefined };
    } catch {
      return { path: filePath, existed: false };
    }
  }

  /**
   * Transfer config file to remote sites-available
   */
  private async transferConfigFile(): Promise<void> {
    const targetPath = constructSitesAvailablePath(this.domain.name);
    const tempConfig = `/tmp/${generateSecureTempFilename('nginx-push-config', 'conf')}`;

    try {
      // Write compiled config to temp local file
      const localTemp = path.join(os.tmpdir(), generateSecureTempFilename('nginx-push-config', 'conf'));
      fs.writeFileSync(localTemp, this.compiledConfig);
      
      await this.ssh.sftpFastPut(localTemp, tempConfig);
      await this.ssh.execWithSudo(`mkdir -p ${shellQuote(path.dirname(targetPath))}`);
      await this.ssh.execWithSudo(`mv ${shellQuote(tempConfig)} ${shellQuote(targetPath)}`);
      
      // Cleanup local temp file
      if (fs.existsSync(localTemp)) fs.unlinkSync(localTemp);
    } finally {
      // Cleanup remote temp file if it still exists
      try {
        await this.ssh.exec(`rm -f ${shellQuote(tempConfig)}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Transfer SSL certs if applicable
   */
  private async transferCertsIfApplicable(): Promise<void> {
    if (!this.remoteCertPath || !this.remoteKeyPath) return;

    const certPath = this.domain.ssl.certPath!;
    const keyPath = this.domain.ssl.keyPath!;

    // Upload to temp location first (user-writable), then move with sudo
    // Use cryptographically secure random filenames to prevent race conditions
    const tempCert = `/tmp/${generateSecureTempFilename('nginx-push-cert', 'pem')}`;
    const tempKey = `/tmp/${generateSecureTempFilename('nginx-push-key', 'pem')}`;

    try {
      await this.ssh.sftpFastPut(certPath, tempCert);
      await this.ssh.sftpFastPut(keyPath, tempKey);

      await this.ssh.execWithSudo(`mkdir -p ${shellQuote(path.dirname(this.remoteCertPath))}`);
      await this.ssh.execWithSudo(`mv ${shellQuote(tempCert)} ${shellQuote(this.remoteCertPath)}`);
      await this.ssh.execWithSudo(`mv ${shellQuote(tempKey)} ${shellQuote(this.remoteKeyPath)}`);
    } finally {
      // Cleanup temp files if they still exist
      try {
        await this.ssh.exec(`rm -f ${shellQuote(tempCert)} ${shellQuote(tempKey)}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Create symlink on remote in sites-enabled
   */
  private async createSymlink(): Promise<void> {
    const sourcePath = constructSitesAvailablePath(this.domain.name);
    const targetPath = constructSitesEnabledPath(this.domain.name);

    await this.ssh.execWithSudo(`mkdir -p ${shellQuote(path.dirname(targetPath))}`);
    await this.ssh.execWithSudo(`ln -sf ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`);
  }

  /**
   * Validate nginx config on remote
   */
  private async validateNginx(): Promise<void> {
    try {
      await this.ssh.execWithSudo('nginx -t');
    } catch (err: any) {
      throw this.formatError('validate nginx config', this.ssh.hostLabel, err, err.message);
    }
  }

  /**
   * Reload nginx on remote
   */
  private async reloadNginx(): Promise<void> {
    try {
      await this.ssh.execWithSudo('nginx -s reload');
    } catch (err: any) {
      throw this.formatError('reload nginx', this.ssh.hostLabel, err, err.message);
    }
  }

  /**
   * Update domain metadata in local DB
   */
  private updateMetadata(): void {
    DomainRepo.update(this.domain.name, {
      lastPushedAt: toISO(),
      configPath: constructSitesAvailablePath(this.domain.name),
    });
  }

  /**
   * Restore a single rollback target on the remote host: remove whatever
   * is there now, then restore the snapshot (file content, symlink target,
   * or nothing if it didn't previously exist).
   */
  private async restoreTarget(target: RollbackTarget): Promise<void> {
    const q = shellQuote(target.path);
    await this.ssh.execWithSudo(`rm -f ${q}`);

    if (!target.snapshot.existed) return;

    if (target.snapshot.isSymlink && target.snapshot.target) {
      await this.ssh.execWithSudo(`ln -sf ${shellQuote(target.snapshot.target)} ${q}`);
      return;
    }

    if (target.snapshot.content) {
      const localTemp = path.join(os.tmpdir(), generateSecureTempFilename('nginx-rollback', 'tmp'));
      const remoteTemp = `/tmp/${generateSecureTempFilename('nginx-rollback', 'tmp')}`;
      
      try {
        fs.writeFileSync(localTemp, target.snapshot.content);
        await this.ssh.sftpFastPut(localTemp, remoteTemp);
        await this.ssh.execWithSudo(`mv ${shellQuote(remoteTemp)} ${q}`);
      } finally {
        if (fs.existsSync(localTemp)) fs.unlinkSync(localTemp);
        try {
          await this.ssh.exec(`rm -f ${shellQuote(remoteTemp)}`);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Rollback to previous state on remote. Each target is restored
   * independently so one failure doesn't prevent the others from being
   * attempted; all failures are collected and reported together.
   */
  protected async rollback(snapshot: PushSnapshot): Promise<void> {
    const targets = buildRollbackTargets(snapshot, {
      configPath: constructSitesAvailablePath(this.domain.name),
      symlinkPath: constructSitesEnabledPath(this.domain.name),
      certPath: this.remoteCertPath,
      keyPath: this.remoteKeyPath,
    });

    const failures: string[] = [];
    for (const target of targets) {
      try {
        await this.restoreTarget(target);
      } catch (err: any) {
        failures.push(`${target.label} (${target.path}): ${err.message}`);
      }
    }

    let validationError: string | undefined;
    try {
      await this.ssh.execWithSudo('nginx -t');
    } catch (err: any) {
      validationError = err.message;
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
   * Execute the push operation with persistent connection
   */
  async push(): Promise<void> {
    try {
      await this.ssh.connect();

      // Compile fresh config
      this.compileConfig();
      
      // For remote deployments, always rewrite cert paths if SSL is enabled
      if (this.shouldCopyCerts()) {
        this.preflightCertCheck();
        this.rewriteCertPaths(this.remoteCertPath!, this.remoteKeyPath!);
      }

      const snapshot = await this.captureSnapshot();

      try {
        await this.transferConfigFile();
        await this.transferCertsIfApplicable();
        await this.createSymlink();
        await this.validateNginx();
        await this.reloadNginx();
        this.updateMetadata();
      } catch (err) {
        await this.rollback(snapshot);
        throw err;
      }
    } finally {
      this.ssh.disconnect();
    }
  }
}

/** Normalize Windows-style separators to POSIX for use in remote paths. */
function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}
