import fs from "fs";
import ssh2 from "ssh2";
import { validateSshCredentials } from "./security-validation.js";
const { Client } = ssh2;
class SshConnection {
  constructor(creds) {
    this.creds = creds;
    this.client = new Client();
    this.connected = false;
    const { remoteHost } = creds;
    validateSshCredentials(remoteHost);
    this.username = remoteHost.includes("@") ? remoteHost.split("@")[0] : "root";
    this.host = remoteHost.includes("@") ? remoteHost.split("@")[1] : remoteHost;
  }
  /**
   * Effective sudo password: explicit sudoPassword takes priority, falls back
   * to sshPassword. Avoids mutating the credentials object.
   */
  get effectiveSudoPassword() {
    return this.creds.sudoPassword ?? this.creds.sshPassword;
  }
  get hostLabel() {
    return this.creds.remoteHost;
  }
  get hasSudoPassword() {
    return !!this.effectiveSudoPassword;
  }
  /** Whether the connection is currently established. */
  get isConnected() {
    return this.connected;
  }
  async connect() {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = void 0;
    }
  }
  async doConnect() {
    const config = {
      host: this.host,
      username: this.username,
      readyTimeout: 3e4
    };
    if (this.creds.sshPassword) {
      config.password = this.creds.sshPassword;
    } else if (this.creds.sshKeyPath) {
      try {
        config.privateKey = fs.readFileSync(this.creds.sshKeyPath);
      } catch (err) {
        throw new Error(
          `Failed to read SSH key at ${this.creds.sshKeyPath}: ${err.message}`
        );
      }
    } else {
      throw new Error(
        "No SSH authentication method provided. Set NGINX_REMOTE_KEY or NGINX_REMOTE_PASSWORD."
      );
    }
    await new Promise((resolve, reject) => {
      this.client = new Client();
      this.client.on("ready", () => {
        this.connected = true;
        resolve();
      }).on("error", (err) => {
        if (this.connected) {
          this.connected = false;
        } else {
          reject(
            new Error(
              `Failed to connect to ${this.creds.remoteHost}: ${err.message}`
            )
          );
        }
      }).on("close", () => {
        this.connected = false;
      }).connect({
        ...config,
        keepaliveInterval: 1e4,
        // send keepalive every 10s
        keepaliveCountMax: 3
        // 3 missed keepalives → connection dead
      });
    });
  }
  disconnect() {
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
  async run(command, stdin, timeoutMs = 3e4, signal) {
    if (!this.connected) {
      throw new Error("(SSH) Not connected");
    }
    if (signal?.aborted) {
      const err = new Error("Operation aborted");
      err.name = "AbortError";
      throw err;
    }
    return new Promise((resolve, reject) => {
      let timedOut = false;
      let channel;
      const abort = (reason) => {
        channel?.destroy();
        reject(reason);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        abort(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const abortHandler = () => {
        if (!timedOut) {
          clearTimeout(timer);
          const err = new Error("Operation aborted");
          err.name = "AbortError";
          abort(err);
        }
      };
      signal?.addEventListener("abort", abortHandler);
      this.client.exec(command, (err, stream) => {
        if (timedOut || signal?.aborted) {
          signal?.removeEventListener("abort", abortHandler);
          stream?.destroy();
          return;
        }
        if (err) {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abortHandler);
          this.connected = false;
          reject(err);
          return;
        }
        channel = stream;
        let stdout = "";
        let stderr = "";
        if (stdin !== void 0) {
          stream.write(stdin);
        }
        stream.on("close", (code) => {
          if (!timedOut && !signal?.aborted) {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abortHandler);
            resolve({ code, result: { stdout, stderr } });
          }
        }).on("data", (data) => {
          stdout += data.toString();
        }).stderr.on("data", (data) => {
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
  async exec(command, stdin, signal) {
    const { code, result } = await this.run(command, stdin, 3e4, signal);
    if (code !== 0) {
      throw new Error(
        this.redact(
          result.stderr || result.stdout || `Command exited with code ${code}`
        )
      );
    }
    return result.stdout;
  }
  /**
   * Execute a command that may require root, trying strategies in order and
   * stopping at the first that succeeds:
   *   1. Plain execution (already root, or passwordless sudo)
   *   2. `sudo -S -p '' <command>` with password piped to stdin
   *   3. `sudo -n <command>` (NOPASSWD sudoers rule)
   *
   * If every strategy fails, throws the first (plain-exec) error as it's
   * usually the most diagnostic (e.g. "no such file" vs. a generic sudo failure).
   *
   * Prefer `execWithSudo()` when you know root is required — use this only
   * when the privilege requirement is genuinely uncertain.
   */
  async execWithSudoFallback(command) {
    try {
      return await this.exec(command);
    } catch (plainErr) {
      try {
        if (this.effectiveSudoPassword) {
          return await this.exec(
            `sudo -S -p '' ${command}`,
            this.effectiveSudoPassword + "\n"
          );
        }
        return await this.exec(`sudo -n ${command}`);
      } catch {
        throw plainErr;
      }
    }
  }
  /**
   * Execute a command with sudo, without attempting a plain execution first.
   * Use this when you know the command requires root privileges.
   * Tries `sudo -S -p ''` (with password) first if available, otherwise `sudo -n`.
   * The `-p ''` flag suppresses the password prompt on stderr entirely.
   */
  async execWithSudo(command, signal) {
    if (this.effectiveSudoPassword) {
      return await this.exec(
        `sudo -S -p '' ${command}`,
        this.effectiveSudoPassword + "\n",
        signal
      );
    }
    return await this.exec(`sudo -n ${command}`, void 0, signal);
  }
  /**
   * Open a persistent exec channel and stream stdout line-by-line via `onLine`.
   * Intended for long-running commands like `tail -f`.
   *
   * Returns a `stop()` function that destroys only the exec channel — not the
   * whole SSH connection — so other concurrent operations (SFTP, exec) are unaffected.
   *
   * If `sudoPassword` is available the command is run via `sudo -S -p ''` with
   * the password written to stdin.
   */
  execStream(command, onLine, onError) {
    if (!this.connected) {
      onError(new Error("(SSH) Not connected"));
      return () => {
      };
    }
    let stopped = false;
    let channel;
    const sudoPassword = this.effectiveSudoPassword;
    const fullCommand = sudoPassword ? `sudo -S -p '' ${command}` : command;
    this.client.exec(fullCommand, (err, stream) => {
      if (err) {
        onError(err);
        return;
      }
      channel = stream;
      if (sudoPassword) {
        stream.write(sudoPassword + "\n");
        stream.end();
      }
      let buf = "";
      stream.on("data", (chunk) => {
        if (stopped) return;
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      });
      stream.stderr.on("data", () => {
      });
      stream.on("close", () => {
        if (buf.length > 0) onLine(buf);
        if (!stopped) onError(new Error("Remote stream closed unexpectedly"));
      });
    });
    return () => {
      stopped = true;
      channel?.destroy();
    };
  }
  async sftpFastPut(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`SFTP put timed out after 30000ms`));
      }, 3e4);
      this.client.sftp((err, sftp) => {
        if (timedOut) return;
        if (err) {
          clearTimeout(timer);
          reject(new Error(`Failed to start SFTP: ${err.message}`));
          return;
        }
        sftp.fastPut(localPath, remotePath, (putErr) => {
          if (timedOut) return;
          clearTimeout(timer);
          if (putErr) {
            reject(
              new Error(
                `Failed to transfer ${localPath} to ${this.creds.remoteHost}: ${putErr.message}`
              )
            );
          } else {
            resolve();
          }
        });
      });
    });
  }
  async sftpReadFile(remotePath) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`SFTP readFile timed out after 15000ms`));
      }, 15e3);
      this.client.sftp((err, sftp) => {
        if (timedOut) return;
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        sftp.readFile(remotePath, (readErr, data) => {
          if (timedOut) return;
          clearTimeout(timer);
          if (readErr) {
            if (readErr.message.includes("No such file")) {
              resolve(null);
            } else {
              reject(readErr);
            }
          } else {
            resolve(data);
          }
        });
      });
    });
  }
  /**
   * Read a chunk of a remote file via SFTP starting at `offset`, up to `maxBytes`.
   * Also returns the file's current total size so callers can detect rotation:
   *   if (offset > result.size) → file was rotated/truncated; reset offset to 0.
   * Returns null if the file does not exist.
   */
  async sftpReadChunk(remotePath, offset, maxBytes, signal) {
    if (signal?.aborted) {
      const err = new Error("Operation aborted");
      err.name = "AbortError";
      throw err;
    }
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`SFTP read timed out after 15000ms`));
      }, 15e3);
      const abortHandler = () => {
        if (!timedOut) {
          clearTimeout(timer);
          const err = new Error("Operation aborted");
          err.name = "AbortError";
          reject(err);
        }
      };
      signal?.addEventListener("abort", abortHandler);
      this.client.sftp((err, sftp) => {
        if (timedOut || signal?.aborted) {
          signal?.removeEventListener("abort", abortHandler);
          return;
        }
        if (err) {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abortHandler);
          reject(err);
          return;
        }
        sftp.stat(remotePath, (statErr, stats) => {
          if (timedOut || signal?.aborted) {
            signal?.removeEventListener("abort", abortHandler);
            return;
          }
          if (statErr) {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abortHandler);
            if (statErr.message.includes("No such file")) {
              resolve(null);
              return;
            }
            reject(statErr);
            return;
          }
          const size = stats.size;
          if (offset >= size) {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abortHandler);
            resolve({ size, chunk: Buffer.alloc(0) });
            return;
          }
          const toRead = Math.min(size - offset, maxBytes);
          const buf = Buffer.alloc(toRead);
          sftp.open(remotePath, "r", (openErr, handle) => {
            if (timedOut || signal?.aborted) {
              signal?.removeEventListener("abort", abortHandler);
              return;
            }
            if (openErr) {
              clearTimeout(timer);
              signal?.removeEventListener("abort", abortHandler);
              reject(openErr);
              return;
            }
            sftp.read(handle, buf, 0, toRead, offset, (readErr, bytesRead) => {
              sftp.close(handle, () => {
              });
              if (timedOut || signal?.aborted) {
                signal?.removeEventListener("abort", abortHandler);
                return;
              }
              clearTimeout(timer);
              signal?.removeEventListener("abort", abortHandler);
              if (readErr) {
                reject(readErr);
                return;
              }
              resolve({ size, chunk: buf.subarray(0, bytesRead) });
            });
          });
        });
      });
    });
  }
  /**
   * Strip the sudo/ssh password out of a string before it's used in an Error
   * message. Defense-in-depth: a misbehaving remote shell could echo stdin
   * back on stderr; this ensures secrets never end up in logs.
   */
  redact(text) {
    const password = this.effectiveSudoPassword;
    if (!password) return text;
    return text.split(password).join("[redacted]");
  }
}
export {
  SshConnection
};
