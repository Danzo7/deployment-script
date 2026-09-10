import fs from 'fs';
import path from 'path';
import { DomainRepo } from '../db/repos.js';
import { DOMAINS_DIR } from '../constants.js';
import { compileDomainConfig } from './nginx-compiler.js';
/**
 * Base class for Nginx push operations
 */
export class NginxPusher {
    constructor(domain, domainName) {
        this.domain = domain;
        // Setup compiled config path
        this.compiledConfigPath = path.join(DOMAINS_DIR, domainName, 'nginx.conf');
        // Initialize empty, will be compiled during push
        this.compiledConfig = '';
    }
    /**
     * Compile the nginx config fresh
     */
    async compileConfig() {
        // Reload domain with routes to get fresh data
        const domainWithRoutes = await DomainRepo.findByNameWithRoutes(this.domain.name);
        this.domain = domainWithRoutes;
        const allDomains = await DomainRepo.getAll();
        this.compiledConfig = compileDomainConfig(this.domain, domainWithRoutes.routes, allDomains);
        // Save to disk for inspection
        fs.mkdirSync(path.dirname(this.compiledConfigPath), { recursive: true });
        fs.writeFileSync(this.compiledConfigPath, this.compiledConfig);
    }
    /**
     * Rewrite SSL certificate paths in the nginx config
     */
    rewriteCertPaths(certPath, keyPath) {
        // Replace ssl_certificate directive
        this.compiledConfig = this.compiledConfig.replace(/ssl_certificate\s+[^;]+;/g, `ssl_certificate ${certPath};`);
        // Replace ssl_certificate_key directive
        this.compiledConfig = this.compiledConfig.replace(/ssl_certificate_key\s+[^;]+;/g, `ssl_certificate_key ${keyPath};`);
    }
    /**
     * Check if SSL certs exist locally before transfer
     */
    preflightCertCheck() {
        if (this.domain.ssl.mode !== 'custom')
            return;
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
    shouldCopyCerts() {
        return this.domain.ssl.mode === 'custom';
    }
    /**
     * Format error message with context
     */
    formatError(operation, targetHost, error, commandOutput) {
        const domainName = this.domain.name;
        let message = `Failed to ${operation} for domain "${domainName}" on ${targetHost}`;
        if (commandOutput) {
            message += `:\n${commandOutput}`;
        }
        else if (error.message) {
            message += `: ${error.message}`;
        }
        return new Error(message);
    }
}
