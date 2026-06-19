import fs from 'fs';
import path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { NginxPusher } from './nginx-pusher.js';
import { DomainRepo } from '../db/repos.js';
import { CERT_DIR } from '../constants.js';
import { Logger } from './logger.js';
import { toISO } from './date-helper.js';
import {
  constructSitesAvailablePath,
  constructSitesEnabledPath,
  PushSnapshot,
  FileSnapshot
} from './domain-push-utils.js';

/**
 * Remote Nginx pusher - uses ssh2 library with persistent connection
 */
export class RemotePusher extends NginxPusher {
  private client: Client;
  private connected: boolean = false;

  constructor(
    domainName: string,
    private remoteHost: string,
    private sshKeyPath?: string,
    private sshPassword?: string
  ) {
    super(domainName);
    this.client = new Client();
  }

  /**
   * Connect to remote host via SSH
   */
  private async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      const config: ConnectConfig = {
        host: this.remoteHost.includes('@') ? this.remoteHost.split('@')[1] : this.remoteHost,
        username: this.remoteHost.includes('@') ? this.remoteHost.split('@')[0] : 'root',
        readyTimeout: 30000,
      };

      // Use password auth if provided, otherwise fall back to key-based auth
      if (this.sshPassword) {
        config.password = this.sshPassword;
      } else if (this.sshKeyPath) {
        try {
          config.privateKey = fs.readFileSync(this.sshKeyPath);
        } catch (err: any) {
          reject(new Error(`Failed to read SSH key at ${this.sshKeyPath}: ${err.message}`));
          return;
        }
      } else {
        reject(new Error('No SSH authentication method provided. Set NGINX_REMOTE_KEY or NGINX_REMOTE_PASSWORD.'));
        return;
      }

      this.client
        .on('ready', () => {
          this.connected = true;
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`Failed to connect to ${this.remoteHost}: ${err.message}`));
        })
        .connect(config);
    });
  }

  /**
   * Disconnect from remote host
   */
  private disconnect(): void {
    if (this.connected) {
      this.client.end();
      this.connected = false;
    }
  }

  /**
   * Execute SSH command on remote host
   */
  private async executeSSH(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream
          .on('close', (code: number) => {
            if (code !== 0) {
              reject(new Error(stderr || stdout || `Command exited with code ${code}`));
            } else {
              resolve(stdout);
            }
          })
          .on('data', (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  /**
   * Transfer file via SFTP
   */
  private async transferFile(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`Failed to start SFTP: ${err.message}`));
          return;
        }

        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) {
            reject(new Error(`Failed to transfer ${localPath} to ${this.remoteHost}: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Read remote file content
   */
  private async readRemoteFile(remotePath: string): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            if (err.message.includes('No such file')) {
              resolve(null);
            } else {
              reject(err);
            }
          } else {
            resolve(data);
          }
        });
      });
    });
  }

  /**
   * Capture snapshot of existing remote files for rollback
   */
  protected async captureSnapshot(): Promise<PushSnapshot> {
    const configPath = constructSitesAvailablePath(this.domain.name);
    const symlinkPath = constructSitesEnabledPath(this.domain.name);

    const snapshot: PushSnapshot = {
      configFile: await this.captureRemoteFileSnapshot(configPath),
      symlink: await this.captureRemoteFileSnapshot(symlinkPath)
    };

    if (this.shouldCopyCerts() && CERT_DIR) {
      const certPath = path.join(CERT_DIR, this.domain.name, 'cert.pem').replace(/\\/g, '/');
      const keyPath = path.join(CERT_DIR, this.domain.name, 'key.pem').replace(/\\/g, '/');
      snapshot.certs = {
        cert: await this.captureRemoteFileSnapshot(certPath),
        key: await this.captureRemoteFileSnapshot(keyPath)
      };
    }

    return snapshot;
  }

  /**
   * Capture a single remote file snapshot
   */
  private async captureRemoteFileSnapshot(filePath: string): Promise<FileSnapshot> {
    try {
      // Check if file is a symlink
      const checkCmd = `[ -L "${filePath}" ] && echo "symlink" || ([ -f "${filePath}" ] && echo "file" || echo "none")`;
      const fileType = (await this.executeSSH(checkCmd)).trim();

      if (fileType === 'none') {
        return { path: filePath, existed: false };
      } else if (fileType === 'symlink') {
        const target = (await this.executeSSH(`readlink "${filePath}"`)).trim();
        return {
          path: filePath,
          existed: true,
          isSymlink: true,
          target
        };
      } else {
        const content = await this.readRemoteFile(filePath);
        return {
          path: filePath,
          existed: true,
          content: content || undefined
        };
      }
    } catch {
      return { path: filePath, existed: false };
    }
  }

  /**
   * Transfer config file to remote sites-available
   */
  private async transferConfigFile(): Promise<void> {
    const targetPath = constructSitesAvailablePath(this.domain.name);
    const targetDir = path.dirname(targetPath);

    await this.executeSSH(`mkdir -p "${targetDir}"`);
    await this.transferFile(this.compiledConfigPath, targetPath);
  }

  /**
   * Transfer SSL certs if applicable
   */
  private async transferCertsIfApplicable(): Promise<void> {
    if (!this.shouldCopyCerts() || !CERT_DIR) return;

    const certPath = this.domain.ssl.certPath!;
    const keyPath = this.domain.ssl.keyPath!;
    const targetDir = path.join(CERT_DIR, this.domain.name).replace(/\\/g, '/');

    await this.executeSSH(`mkdir -p "${targetDir}"`);
    await this.transferFile(certPath, path.join(targetDir, 'cert.pem').replace(/\\/g, '/'));
    await this.transferFile(keyPath, path.join(targetDir, 'key.pem').replace(/\\/g, '/'));
  }

  /**
   * Create symlink on remote in sites-enabled
   */
  private async createSymlink(): Promise<void> {
    const sourcePath = constructSitesAvailablePath(this.domain.name);
    const targetPath = constructSitesEnabledPath(this.domain.name);
    const targetDir = path.dirname(targetPath);

    await this.executeSSH(`mkdir -p "${targetDir}"`);
    await this.executeSSH(`ln -sf "${sourcePath}" "${targetPath}"`);
  }

  /**
   * Validate nginx config on remote
   */
  private async validateNginx(): Promise<void> {
    try {
      // Try without sudo first, fall back to sudo if needed
      try {
        await this.executeSSH('nginx -t');
      } catch {
        await this.executeSSH('sudo -n nginx -t');
      }
    } catch (err: any) {
      throw this.formatError('validate nginx config', this.remoteHost, err, err.message);
    }
  }

  /**
   * Reload nginx on remote
   */
  private async reloadNginx(): Promise<void> {
    try {
      // Try without sudo first, fall back to sudo if needed
      try {
        await this.executeSSH('nginx -s reload');
      } catch {
        await this.executeSSH('sudo -n nginx -s reload');
      }
    } catch (err: any) {
      throw this.formatError('reload nginx', this.remoteHost, err, err.message);
    }
  }

  /**
   * Update domain metadata in local DB
   */
  private updateMetadata(): void {
    const configPath = constructSitesAvailablePath(this.domain.name);
    DomainRepo.update(this.domain.name, {
      lastPushedAt: toISO(),
      configPath: configPath
    });
  }

  /**
   * Rollback to previous state on remote
   */
  protected async rollback(snapshot: PushSnapshot): Promise<void> {
    try {
      const configPath = constructSitesAvailablePath(this.domain.name);
      await this.executeSSH(`rm -f "${configPath}"`);

      if (snapshot.configFile.existed && snapshot.configFile.content) {
        const tempFile = `/tmp/nginx-rollback-${this.domain.name}.conf`;
        try {
          fs.writeFileSync(tempFile, snapshot.configFile.content);
          await this.transferFile(tempFile, configPath);
        } finally {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        }
      }

      const symlinkPath = constructSitesEnabledPath(this.domain.name);
      await this.executeSSH(`rm -f "${symlinkPath}"`);

      if (snapshot.symlink.existed && snapshot.symlink.isSymlink && snapshot.symlink.target) {
        await this.executeSSH(`ln -sf "${snapshot.symlink.target}" "${symlinkPath}"`);
      }

      if (snapshot.certs && CERT_DIR) {
        const certPath = path.join(CERT_DIR, this.domain.name, 'cert.pem').replace(/\\/g, '/');
        const keyPath = path.join(CERT_DIR, this.domain.name, 'key.pem').replace(/\\/g, '/');

        await this.executeSSH(`rm -f "${certPath}"`);
        await this.executeSSH(`rm -f "${keyPath}"`);

        if (snapshot.certs.cert.existed && snapshot.certs.cert.content) {
          const tempCert = `/tmp/nginx-rollback-cert-${this.domain.name}.pem`;
          try {
            fs.writeFileSync(tempCert, snapshot.certs.cert.content);
            await this.transferFile(tempCert, certPath);
          } finally {
            if (fs.existsSync(tempCert)) {
              fs.unlinkSync(tempCert);
            }
          }
        }
        if (snapshot.certs.key.existed && snapshot.certs.key.content) {
          const tempKey = `/tmp/nginx-rollback-key-${this.domain.name}.pem`;
          try {
            fs.writeFileSync(tempKey, snapshot.certs.key.content);
            await this.transferFile(tempKey, keyPath);
          } finally {
            if (fs.existsSync(tempKey)) {
              fs.unlinkSync(tempKey);
            }
          }
        }
      }

      try {
        // Try without sudo first, fall back to sudo if needed
        try {
          await this.executeSSH('nginx -t');
        } catch {
          await this.executeSSH('sudo -n nginx -t');
        }
        Logger.info('Rollback completed successfully. Nginx config restored to previous state.');
      } catch (err: any) {
        throw new Error(
          `CRITICAL: Rollback failed and Nginx state may be inconsistent. Manual intervention required. Error: ${err.message}`
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
   * Execute the push operation with persistent connection
   */
  async push(): Promise<void> {
    try {
      await this.connect();

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
      this.disconnect();
    }
  }
}
