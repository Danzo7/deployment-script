import fs from "fs";
import os from "os";
import path from "path";
import { NginxPusher } from "./nginx-pusher.js";
import { DomainRepo } from "../db/repos.js";
import { PUSH_CERT_DIR } from "../constants.js";
import { Logger } from "./logger.js";
import { SshConnection } from "./ssh-connection.js";
import {
  constructSitesAvailablePath,
  constructSitesEnabledPath,
  buildRollbackTargets,
  shellQuote
} from "./domain-push-utils.js";
import {
  validateSafeDomainName,
  validateCertPath,
  generateSecureTempFilename
} from "./security-validation.js";
import {
  compileDmLogFormatSnippet,
  DM_LOG_FORMAT_SNIPPET_PATH
} from "./nginx-compiler.js";
class RemotePusher extends NginxPusher {
  constructor(domain, domainName, remoteHost, sshKeyPath, sshPassword, sudoPassword) {
    super(domain, domainName);
    validateSafeDomainName(domainName);
    const creds = {
      remoteHost,
      sshKeyPath,
      sshPassword,
      sudoPassword
    };
    this.ssh = new SshConnection(creds);
    const baseCertDir = PUSH_CERT_DIR ?? "/etc/nginx/ssl";
    this.remoteCertDir = validateCertPath(baseCertDir, domainName);
  }
  /**
   * Factory method to create RemotePusher instance
   */
  static async create(domainName, remoteHost, sshKeyPath, sshPassword, sudoPassword) {
    const domain = await DomainRepo.findByName(domainName);
    return new RemotePusher(
      domain,
      domainName,
      remoteHost,
      sshKeyPath,
      sshPassword,
      sudoPassword
    );
  }
  /** Remote path for the SSL certificate, if certs are in play. */
  get remoteCertPath() {
    if (!this.shouldCopyCerts()) return void 0;
    return toPosixPath(path.join(this.remoteCertDir, "cert.pem"));
  }
  /** Remote path for the SSL private key, if certs are in play. */
  get remoteKeyPath() {
    if (!this.shouldCopyCerts()) return void 0;
    return toPosixPath(path.join(this.remoteCertDir, "key.pem"));
  }
  /**
   * Capture snapshot of existing remote files for rollback
   */
  async captureSnapshot() {
    const configPath = constructSitesAvailablePath(this.domain.name);
    const symlinkPath = constructSitesEnabledPath(this.domain.name);
    const snapshot = {
      configFile: await this.captureRemoteFileSnapshot(configPath),
      symlink: await this.captureRemoteFileSnapshot(symlinkPath)
    };
    if (this.remoteCertPath && this.remoteKeyPath) {
      snapshot.certs = {
        cert: await this.captureRemoteFileSnapshot(this.remoteCertPath),
        key: await this.captureRemoteFileSnapshot(this.remoteKeyPath)
      };
    }
    return snapshot;
  }
  /**
   * Capture a single remote file snapshot
   */
  async captureRemoteFileSnapshot(filePath) {
    const q = shellQuote(filePath);
    try {
      const checkCmd = `[ -L ${q} ] && echo "symlink" || ([ -f ${q} ] && echo "file" || echo "none")`;
      const fileType = (await this.ssh.exec(checkCmd)).trim();
      if (fileType === "none") {
        return { path: filePath, existed: false };
      }
      if (fileType === "symlink") {
        const target = (await this.ssh.exec(`readlink ${q}`)).trim();
        return { path: filePath, existed: true, isSymlink: true, target };
      }
      const content = await this.ssh.sftpReadFile(filePath);
      return { path: filePath, existed: true, content: content || void 0 };
    } catch {
      return { path: filePath, existed: false };
    }
  }
  /**
   * Transfer config file to remote sites-available
   */
  async transferConfigFile() {
    const targetPath = constructSitesAvailablePath(this.domain.name);
    const tempConfig = `/tmp/${generateSecureTempFilename("nginx-push-config", "conf")}`;
    try {
      const localTemp = path.join(
        os.tmpdir(),
        generateSecureTempFilename("nginx-push-config", "conf")
      );
      fs.writeFileSync(localTemp, this.compiledConfig);
      await this.ssh.sftpFastPut(localTemp, tempConfig);
      await this.ssh.execWithSudo(
        `mkdir -p ${shellQuote(path.dirname(targetPath))}`
      );
      await this.ssh.execWithSudo(
        `mv ${shellQuote(tempConfig)} ${shellQuote(targetPath)}`
      );
      if (fs.existsSync(localTemp)) fs.unlinkSync(localTemp);
    } finally {
      try {
        await this.ssh.exec(`rm -f ${shellQuote(tempConfig)}`);
      } catch {
      }
    }
  }
  /**
   * Transfer SSL certs if applicable
   */
  async transferCertsIfApplicable() {
    if (!this.remoteCertPath || !this.remoteKeyPath) return;
    const certPath = this.domain.ssl.certPath;
    const keyPath = this.domain.ssl.keyPath;
    const tempCert = `/tmp/${generateSecureTempFilename("nginx-push-cert", "pem")}`;
    const tempKey = `/tmp/${generateSecureTempFilename("nginx-push-key", "pem")}`;
    try {
      await this.ssh.sftpFastPut(certPath, tempCert);
      await this.ssh.sftpFastPut(keyPath, tempKey);
      await this.ssh.execWithSudo(
        `mkdir -p ${shellQuote(path.dirname(this.remoteCertPath))}`
      );
      await this.ssh.execWithSudo(
        `mv ${shellQuote(tempCert)} ${shellQuote(this.remoteCertPath)}`
      );
      await this.ssh.execWithSudo(
        `mv ${shellQuote(tempKey)} ${shellQuote(this.remoteKeyPath)}`
      );
    } finally {
      try {
        await this.ssh.exec(
          `rm -f ${shellQuote(tempCert)} ${shellQuote(tempKey)}`
        );
      } catch {
      }
    }
  }
  /**
   * Create symlink on remote in sites-enabled
   */
  async createSymlink() {
    const sourcePath = constructSitesAvailablePath(this.domain.name);
    const targetPath = constructSitesEnabledPath(this.domain.name);
    await this.ssh.execWithSudo(
      `mkdir -p ${shellQuote(path.dirname(targetPath))}`
    );
    await this.ssh.execWithSudo(
      `ln -sf ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`
    );
  }
  /**
   * Ensure the dm_json log_format snippet exists on the remote host.
   * Written idempotently via a temp file + sudo mv.
   */
  async ensureLogFormatSnippet() {
    const snippet = compileDmLogFormatSnippet();
    const tempFile = `/tmp/${generateSecureTempFilename("dm-log-format", "conf")}`;
    const localTemp = path.join(
      os.tmpdir(),
      generateSecureTempFilename("dm-log-format", "conf")
    );
    try {
      fs.writeFileSync(localTemp, snippet);
      await this.ssh.sftpFastPut(localTemp, tempFile);
      await this.ssh.execWithSudo(
        `sh -c ${shellQuote(`mkdir -p ${path.dirname(DM_LOG_FORMAT_SNIPPET_PATH)} && mv ${shellQuote(tempFile)} ${shellQuote(DM_LOG_FORMAT_SNIPPET_PATH)}`)}`
      );
    } catch (err) {
      Logger.warn(
        `Could not write dm_json log format snippet on remote: ${err.message}`
      );
    } finally {
      if (fs.existsSync(localTemp)) fs.unlinkSync(localTemp);
      try {
        await this.ssh.exec(`rm -f ${shellQuote(tempFile)}`);
      } catch {
      }
    }
  }
  /**
   * Validate nginx config on remote
   */
  async validateNginx() {
    try {
      await this.ssh.execWithSudo("nginx -t");
    } catch (err) {
      throw this.formatError(
        "validate nginx config",
        this.ssh.hostLabel,
        err,
        err.message
      );
    }
  }
  /**
   * Reload nginx on remote
   */
  async reloadNginx() {
    try {
      await this.ssh.execWithSudo("nginx -s reload");
    } catch (err) {
      throw this.formatError(
        "reload nginx",
        this.ssh.hostLabel,
        err,
        err.message
      );
    }
  }
  /**
   * Update domain metadata in local DB
   */
  updateMetadata() {
    DomainRepo.update(this.domain.name, {
      lastPushedAt: /* @__PURE__ */ new Date(),
      configPath: constructSitesAvailablePath(this.domain.name)
    });
  }
  /**
   * Restore a single rollback target on the remote host: remove whatever
   * is there now, then restore the snapshot (file content, symlink target,
   * or nothing if it didn't previously exist).
   */
  async restoreTarget(target) {
    const q = shellQuote(target.path);
    await this.ssh.execWithSudo(`rm -f ${q}`);
    if (!target.snapshot.existed) return;
    if (target.snapshot.isSymlink && target.snapshot.target) {
      await this.ssh.execWithSudo(
        `ln -sf ${shellQuote(target.snapshot.target)} ${q}`
      );
      return;
    }
    if (target.snapshot.content) {
      const localTemp = path.join(
        os.tmpdir(),
        generateSecureTempFilename("nginx-rollback", "tmp")
      );
      const remoteTemp = `/tmp/${generateSecureTempFilename("nginx-rollback", "tmp")}`;
      try {
        fs.writeFileSync(localTemp, target.snapshot.content);
        await this.ssh.sftpFastPut(localTemp, remoteTemp);
        await this.ssh.execWithSudo(`mv ${shellQuote(remoteTemp)} ${q}`);
      } finally {
        if (fs.existsSync(localTemp)) fs.unlinkSync(localTemp);
        try {
          await this.ssh.exec(`rm -f ${shellQuote(remoteTemp)}`);
        } catch {
        }
      }
    }
  }
  /**
   * Rollback to previous state on remote. Each target is restored
   * independently so one failure doesn't prevent the others from being
   * attempted; all failures are collected and reported together.
   */
  async rollback(snapshot) {
    const targets = buildRollbackTargets(snapshot, {
      configPath: constructSitesAvailablePath(this.domain.name),
      symlinkPath: constructSitesEnabledPath(this.domain.name),
      certPath: this.remoteCertPath,
      keyPath: this.remoteKeyPath
    });
    const failures = [];
    for (const target of targets) {
      try {
        await this.restoreTarget(target);
      } catch (err) {
        failures.push(`${target.label} (${target.path}): ${err.message}`);
      }
    }
    let validationError;
    try {
      await this.ssh.execWithSudo("nginx -t");
    } catch (err) {
      validationError = err.message;
    }
    if (failures.length === 0 && !validationError) {
      Logger.info(
        "Rollback completed successfully. Nginx config restored to previous state."
      );
      return;
    }
    const parts = [
      ...failures.map((f) => `- failed to restore ${f}`),
      ...validationError ? [`- nginx -t failed after rollback: ${validationError}`] : []
    ];
    throw new Error(
      `CRITICAL: Rollback failed and Nginx state may be inconsistent. Manual intervention required.
${parts.join("\n")}`
    );
  }
  /**
   * Execute the push operation with persistent connection
   */
  async push() {
    try {
      await this.ssh.connect();
      await this.compileConfig();
      if (this.shouldCopyCerts()) {
        this.preflightCertCheck();
        this.rewriteCertPaths(this.remoteCertPath, this.remoteKeyPath);
      }
      const snapshot = await this.captureSnapshot();
      try {
        await this.transferConfigFile();
        await this.transferCertsIfApplicable();
        await this.createSymlink();
        await this.ensureLogFormatSnippet();
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
function toPosixPath(p) {
  return p.replace(/\\/g, "/");
}
export {
  RemotePusher
};
