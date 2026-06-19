/**
 * Utility functions for domain push operations
 */

import fs from 'fs';

/**
 * File snapshot interface for rollback support
 */
export interface FileSnapshot {
  path: string;
  existed: boolean;
  content?: Buffer;
  isSymlink?: boolean;
  target?: string;
}

/**
 * Push snapshot interface containing all file states
 */
export interface PushSnapshot {
  configFile: FileSnapshot;
  symlink: FileSnapshot;
  certs?: {
    cert: FileSnapshot;
    key: FileSnapshot;
  };
}

/**
 * Capture a file snapshot for local files
 * @param filePath - The file path to snapshot
 * @returns FileSnapshot containing the current state
 */
export function captureFileSnapshot(filePath: string): FileSnapshot {
  try {
    const stats = fs.lstatSync(filePath);
    const isSymlink = stats.isSymbolicLink();
    
    if (isSymlink) {
      const target = fs.readlinkSync(filePath);
      return {
        path: filePath,
        existed: true,
        isSymlink: true,
        target
      };
    } else {
      const content = fs.readFileSync(filePath);
      return {
        path: filePath,
        existed: true,
        content
      };
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return {
        path: filePath,
        existed: false
      };
    }
    throw err;
  }
}

/**
 * Normalize domain filename by replacing dots with underscores
 * @param domainName - The domain name (e.g., "api.example.com")
 * @returns The normalized filename (e.g., "api_example_com")
 */
export function normalizeDomainFilename(domainName: string): string {
  return domainName.replace(/\./g, '_');
}

/**
 * Construct the sites-available path for a domain config
 * @param domainName - The domain name
 * @returns The full path (e.g., "/etc/nginx/sites-available/api_example_com.conf")
 */
export function constructSitesAvailablePath(domainName: string): string {
  const filename = normalizeDomainFilename(domainName);
  return `/etc/nginx/sites-available/${filename}.conf`;
}

/**
 * Construct the sites-enabled path for a domain config symlink
 * @param domainName - The domain name
 * @returns The full path (e.g., "/etc/nginx/sites-enabled/api_example_com.conf")
 */
export function constructSitesEnabledPath(domainName: string): string {
  const filename = normalizeDomainFilename(domainName);
  return `/etc/nginx/sites-enabled/${filename}.conf`;
}
