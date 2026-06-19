import fs from 'fs';
import path from 'path';
import { Domain } from '../db/model.js';
import { DomainRepo, RouteRepo, AppRepo } from '../db/repos.js';
import { DOMAINS_DIR } from '../constants.js';
import { PushSnapshot } from './domain-push-utils.js';
import { compileDomainConfig } from './nginx-compiler.js';

/**
 * Base class for Nginx push operations
 */
export abstract class NginxPusher {
  protected domain: Domain;
  protected compiledConfigPath: string;
  protected compiledConfig: string;

  constructor(domainName: string) {
    // Preflight: Domain lookup
    this.domain = DomainRepo.findByName(domainName);
    
    // Setup compiled config path
    this.compiledConfigPath = path.join(DOMAINS_DIR, domainName, 'nginx.conf');
    
    // Initialize empty, will be compiled during push
    this.compiledConfig = '';
  }

  /**
   * Compile the nginx config fresh
   */
  protected compileConfig(): void {
    const routes = RouteRepo.getAll().filter((r) => r.domainId === this.domain.id);
    const apps = AppRepo.getAll();
    const allDomains = DomainRepo.getAll();
    
    this.compiledConfig = compileDomainConfig(this.domain, routes, apps, allDomains);
    
    // Save to disk for inspection
    fs.mkdirSync(path.dirname(this.compiledConfigPath), { recursive: true });
    fs.writeFileSync(this.compiledConfigPath, this.compiledConfig);
  }

  /**
   * Rewrite SSL certificate paths in the nginx config
   */
  protected rewriteCertPaths(certPath: string, keyPath: string): void {
    // Replace ssl_certificate directive
    this.compiledConfig = this.compiledConfig.replace(
      /ssl_certificate\s+[^;]+;/g,
      `ssl_certificate ${certPath};`
    );
    
    // Replace ssl_certificate_key directive
    this.compiledConfig = this.compiledConfig.replace(
      /ssl_certificate_key\s+[^;]+;/g,
      `ssl_certificate_key ${keyPath};`
    );
  }

  /**
   * Check if SSL certs exist locally before transfer
   */
  protected preflightCertCheck(): void {
    if (this.domain.ssl.mode !== 'custom') return;
    
    const certPath = this.domain.ssl.certPath;
    const keyPath = this.domain.ssl.keyPath;
    
    if (certPath && !fs.existsSync(certPath)) {
      throw new Error(`SSL certificate file missing: ${certPath}`);
    }
    if (keyPath && !fs.existsSync(keyPath)) {
      throw new Error(`SSL private key file missing: ${keyPath}`);
    }
  }

  /**
   * Check if certs should be copied
   */
  protected shouldCopyCerts(): boolean {
    return this.domain.ssl.mode === 'custom';
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
