import fs from 'fs';
import path from 'path';
import { Domain } from '../db/model.js';
import { DomainRepo } from '../db/repos.js';
import { CERT_DIR, DOMAINS_DIR } from '../constants.js';
import { PushSnapshot } from './domain-push-utils.js';

/**
 * Base class for Nginx push operations
 */
export abstract class NginxPusher {
  protected domain: Domain;
  protected compiledConfigPath: string;

  constructor(domainName: string) {
    // Preflight: Domain lookup
    this.domain = DomainRepo.findByName(domainName);
    
    // Preflight: Config file check
    this.compiledConfigPath = path.join(DOMAINS_DIR, domainName, 'nginx.conf');
    if (!fs.existsSync(this.compiledConfigPath)) {
      throw new Error(
        `Compiled config not found for domain "${domainName}" at ${this.compiledConfigPath}. Run 'dm domain compile ${domainName}' first.`
      );
    }
    
    // Preflight: Cert existence check
    this.preflightCertCheck();
  }

  /**
   * Check if SSL certs exist locally before transfer
   */
  private preflightCertCheck(): void {
    if (!CERT_DIR) return;
    if (this.domain.ssl.mode !== 'custom') return;
    
    const certPath = this.domain.ssl.certPath;
    const keyPath = this.domain.ssl.keyPath;
    
    if (certPath && !fs.existsSync(certPath)) {
      throw new Error(`SSL certificate file missing: ${certPath}`);
    }
    if (keyPath && !fs.existsSync(keyPath)) {
      throw new Error(`SSL certificate file missing: ${keyPath}`);
    }
  }

  /**
   * Check if certs should be copied
   */
  protected shouldCopyCerts(): boolean {
    if (!CERT_DIR) return false;
    if (this.domain.ssl.mode !== 'custom') return false;
    return true;
  }

  /**
   * Format error message with context
   */
  protected formatError(
    operation: string,
    targetHost: string,
    error: any,
    commandOutput?: string
  ): Error {
    const domainName = this.domain.name;
    let message = `Failed to ${operation} for domain "${domainName}" on ${targetHost}`;
    
    if (commandOutput) {
      message += `:\n${commandOutput}`;
    } else if (error.message) {
      message += `: ${error.message}`;
    }
    
    return new Error(message);
  }

  /**
   * Abstract method to be implemented by subclasses
   */
  abstract push(): Promise<void>;
  
  /**
   * Abstract method to capture snapshot
   */
  protected abstract captureSnapshot(): Promise<PushSnapshot>;
  
  /**
   * Abstract method to rollback
   */
  protected abstract rollback(snapshot: PushSnapshot): Promise<void>;
}
