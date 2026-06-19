import fs from 'fs';
import { Client, ConnectConfig } from 'ssh2';

export interface SshCredentials {
  remoteHost: string;
  sshKeyPath?: string;
  sshPassword?: string;
  sudoPassword?: string;
}

/**
 * Result of a remote command execution attempt.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Thin wrapper around an ssh2 Client that owns the connection lifecycle and
 * exposes exec/sftp primitives. Contains no domain/nginx-specific logic —
 * that lives in RemotePusher. Pulling this out keeps RemotePusher focused on
 * "what to do" rather than "how to talk to a remote shell."
 */
export class SshConnection {
  private client: Client = new Client();
  private connected = false;
  private readonly host: string;
  private readonly username: string;

  constructor(private readonly creds: SshCredentials) {
    const { remoteHost } = creds;
    this.username = remoteHost.includes('@') ? remoteHost.split('@')[0] : 'root';
    this.host = remoteHost.includes('@') ? remoteHost.split('@')[1] : remoteHost;

    // Default sudo password to the SSH password if not explicitly set.
    if (!this.creds.sudoPassword && this.creds.sshPassword) {
      this.creds.sudoPassword = this.creds.sshPassword;
    }
  }

  get hostLabel(): string {
    return this.creds.remoteHost;
  }

  get hasSudoPassword(): boolean {
    return !!this.creds.sudoPassword;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const config: ConnectConfig = {
      host: this.host,
      username: this.username,
      readyTimeout: 30000,
    };

    if (this.creds.sshPassword) {
      config.password = this.creds.sshPassword;
    } else if (this.creds.sshKeyPath) {
      try {
        config.privateKey = fs.readFileSync(this.creds.sshKeyPath);
      } catch (err: any) {
        throw new Error(`Failed to read SSH key at ${this.creds.sshKeyPath}: ${err.message}`);
      }
    } else {
      throw new Error('No SSH authentication method provided. Set NGINX_REMOTE_KEY or NGINX_REMOTE_PASSWORD.');
    }

    await new Promise<void>((resolve, reject) => {
      // Fresh client per connect attempt — ssh2 Clients aren't guaranteed
      // reusable after .end(), so reconnecting after disconnect() is safe.
      this.client = new Client();
      this.client
        .on('ready', () => {
          this.connected = true;
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`Failed to connect to ${this.creds.remoteHost}: ${err.message}`));
        })
        .connect(config);
    });
  }

  disconnect(): void {
    if (this.connected) {
      this.client.end();
      this.connected = false;
    }
  }

  /**
   * Run a raw command over SSH and return stdout/stderr. Does not throw on
   * non-zero exit; callers decide what failure means for their use case.
   * Use `exec()` for the common "throw on non-zero exit" case instead.
   */
  private async run(command: string, stdin?: string): Promise<{ code: number; result: ExecResult }> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        if (stdin !== undefined) {
          stream.write(stdin);
        }

        stream
          .on('close', (code: number) => resolve({ code, result: { stdout, stderr } }))
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
   * Execute a command, throwing on non-zero exit. The thrown error message
   * is scrubbed of any configured password so secrets never leak into logs
   * or surfaced error messages.
   */
  async exec(command: string, stdin?: string): Promise<string> {
    const { code, result } = await this.run(command, stdin);
    if (code !== 0) {
      throw new Error(this.redact(result.stderr || result.stdout || `Command exited with code ${code}`));
    }
    return result.stdout;
  }

  /**
   * Execute a command that may require root, trying three strategies in
   * order and stopping at the first that succeeds:
   *   1. Plain execution (works if already root or passwordless sudo is configured oddly)
   *   2. `sudo -S <command>` with the sudo password piped to stdin
   *   3. `sudo -n <command>` (non-interactive — relies on a NOPASSWD sudoers rule)
   *
   * This collapses what was previously three near-identical try/catch
   * blocks (one each for mkdir, validate, reload, plus rollback's inline
   * copy) into a single, reusable path.
   *
   * If every strategy fails, throws the *first* (plain-exec) error rather
   * than the last, since the plain-exec failure is usually the most
   * diagnostic one (e.g. "no such file" vs. a generic sudo auth failure).
   */
  async execWithSudoFallback(command: string): Promise<string> {
    try {
      return await this.exec(command);
    } catch (plainErr: any) {
      try {
        if (this.creds.sudoPassword) {
          return await this.exec(`sudo -S ${command}`, this.creds.sudoPassword + '\n');
        }
        return await this.exec(`sudo -n ${command}`);
      } catch {
        // Surface the original, more diagnostic error rather than the
        // generic sudo-auth failure that usually results from the retry.
        throw plainErr;
      }
    }
  }

  async sftpFastPut(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`Failed to start SFTP: ${err.message}`));
          return;
        }
        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) {
            reject(new Error(`Failed to transfer ${localPath} to ${this.creds.remoteHost}: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    });
  }

  async sftpReadFile(remotePath: string): Promise<Buffer | null> {
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
   * Strip the sudo password out of a string before it's allowed into an
   * Error message. A misbehaving remote shell could in principle echo
   * stdin back on stderr; this is a defense-in-depth measure so a secret
   * never ends up in logs even if that happens.
   */
  private redact(text: string): string {
    if (!this.creds.sudoPassword) return text;
    return text.split(this.creds.sudoPassword).join('[redacted]');
  }
}
