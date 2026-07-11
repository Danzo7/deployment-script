import crypto from 'crypto';
import path from 'path';

/**
 * Security validation utilities to prevent injection attacks and path traversal.
 * These utilities provide defense-in-depth validation for user-controlled inputs
 * used in shell commands, file paths, and SSH operations.
 */

/**
 * Validates that a string contains only safe characters and doesn't include
 * shell metacharacters that could be used for command injection.
 *
 * Allowed: alphanumeric, dots, hyphens, underscores
 * Disallowed: shell metacharacters like ; | & $ ` ( ) < > \ ' " and whitespace
 *
 * @throws Error if the input contains unsafe characters
 */
export function validateSafeString(value: string, fieldName: string): void {
  if (!value || value.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }

  // Check for shell metacharacters and control characters
  // eslint-disable-next-line no-control-regex
  const dangerousChars = /[;&|`$()<>\\'"!\s\u0000-\u001F\u007F]/;
  if (dangerousChars.test(value)) {
    throw new Error(
      `${fieldName} contains unsafe characters. Only alphanumeric, dots, hyphens, and underscores are allowed.`
    );
  }

  // Additional check for common injection patterns
  const injectionPatterns = /(\.\.\/|\.\.\\|~\/|~\\)/;
  if (injectionPatterns.test(value)) {
    throw new Error(
      `${fieldName} contains potentially malicious path traversal patterns`
    );
  }
}

/**
 * Validates that a domain name or hostname is safe to use in file paths and commands.
 * More strict than validateHostname as it's meant for security-sensitive contexts.
 *
 * @throws Error if the domain is invalid or contains unsafe characters
 */
export function validateSafeDomainName(domainName: string): void {
  if (!domainName || domainName.length === 0) {
    throw new Error('Domain name cannot be empty');
  }

  if (domainName.length > 253) {
    throw new Error('Domain name exceeds maximum length of 253 characters');
  }

  // Check for path traversal attempts
  if (domainName.includes('..') || domainName.includes('~')) {
    throw new Error('Domain name contains path traversal characters');
  }

  // Check for shell metacharacters
  // eslint-disable-next-line no-control-regex
  const dangerousChars = /[;&|`$()<>\\'"!\s\u0000-\u001F\u007F]/;
  if (dangerousChars.test(domainName)) {
    throw new Error('Domain name contains unsafe shell metacharacters');
  }

  // Validate DNS label format
  const labels = domainName.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new Error(
        `Domain label "${label}" must be between 1 and 63 characters`
      );
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw new Error(
        `Domain label "${label}" cannot start or end with a hyphen`
      );
    }
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      throw new Error(`Domain label "${label}" contains invalid characters`);
    }
  }
}

/**
 * Validates that a file path is safe and doesn't contain traversal attacks.
 * Normalizes the path and ensures it doesn't escape the base directory.
 *
 * @param filePath - The file path to validate
 * @param baseDir - The base directory that the path must remain within
 * @param fieldName - Human-readable field name for error messages
 * @throws Error if the path is unsafe or attempts to escape baseDir
 */
export function validateSafePath(
  filePath: string,
  baseDir: string,
  fieldName: string
): void {
  if (!filePath || filePath.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }

  // Normalize to prevent path traversal tricks
  const normalizedPath = path.normalize(filePath);
  const normalizedBase = path.normalize(baseDir);

  // Check if path tries to escape base directory
  const resolvedPath = path.resolve(normalizedBase, normalizedPath);
  const resolvedBase = path.resolve(normalizedBase);

  if (
    !resolvedPath.startsWith(resolvedBase + path.sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new Error(
      `${fieldName} attempts to escape base directory: ${filePath}`
    );
  }

  // Additional checks for suspicious patterns
  if (filePath.includes('\x00')) {
    throw new Error(`${fieldName} contains null byte`);
  }

  // Check for shell metacharacters in the filename part
  const filename = path.basename(filePath);
  // eslint-disable-next-line no-control-regex
  const dangerousChars = /[;&|`$()<>\\'"!\u0000-\u001F\u007F]/;
  if (dangerousChars.test(filename)) {
    throw new Error(`${fieldName} filename contains unsafe characters`);
  }
}

/**
 * Validates SSH connection credentials for security issues.
 *
 * @param remoteHost - The remote host string (format: [user@]host)
 * @throws Error if credentials contain suspicious patterns
 */
export function validateSshCredentials(remoteHost: string): void {
  if (!remoteHost || remoteHost.length === 0) {
    throw new Error('Remote host cannot be empty');
  }

  // Check for shell metacharacters
  // eslint-disable-next-line no-control-regex
  const dangerousChars = /[;&|`$()<>\\'"!\u0000-\u001F\u007F]/;
  if (dangerousChars.test(remoteHost)) {
    throw new Error('Remote host contains unsafe shell metacharacters');
  }

  // Validate format: [user@]host
  const parts = remoteHost.split('@');
  if (parts.length > 2) {
    throw new Error('Invalid remote host format. Expected: [user@]host');
  }

  if (parts.length === 2) {
    const [username, host] = parts;

    // Validate username
    if (!username || username.length === 0) {
      throw new Error('Username cannot be empty');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new Error(
        'Username contains invalid characters. Only alphanumeric, underscore, and hyphen allowed.'
      );
    }

    // Validate host
    validateHostPart(host);
  } else {
    // Just host
    validateHostPart(parts[0]);
  }
}

/**
 * Validates the host part of an SSH connection string.
 * Can be a hostname, domain, or IP address.
 */
function validateHostPart(host: string): void {
  if (!host || host.length === 0) {
    throw new Error('Host cannot be empty');
  }

  // Check if it's an IPv4 address
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = host.match(ipv4Pattern);
  if (ipv4Match) {
    const valid = ipv4Match.slice(1).every((octet) => {
      const n = parseInt(octet, 10);
      return n >= 0 && n <= 255;
    });
    if (!valid) {
      throw new Error('Invalid IPv4 address');
    }
    return;
  }

  // Check if it's a valid hostname
  const labels = host.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new Error(
        `Host label "${label}" must be between 1 and 63 characters`
      );
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw new Error(
        `Host label "${label}" cannot start or end with a hyphen`
      );
    }
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      throw new Error(`Host label "${label}" contains invalid characters`);
    }
  }
}

/**
 * Generates a cryptographically secure random filename for temporary files.
 * Uses crypto.randomBytes to ensure unpredictability.
 *
 * @param prefix - Prefix for the filename
 * @param extension - File extension (without dot)
 * @returns A secure random filename
 */
export function generateSecureTempFilename(
  prefix: string,
  extension: string
): string {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${prefix}-${timestamp}-${randomBytes}.${extension}`;
}

/**
 * Validates that a certificate directory path is safe.
 * Prevents path traversal when constructing cert/key paths.
 *
 * @param certDir - The certificate directory path
 * @param domainName - The domain name (already validated)
 * @returns The safe, normalized path for the domain's cert directory
 */
export function validateCertPath(certDir: string, domainName: string): string {
  if (!certDir || certDir.length === 0) {
    throw new Error('Certificate directory cannot be empty');
  }

  // Validate domain name is safe
  validateSafeDomainName(domainName);

  // Normalize the base cert directory
  const normalizedCertDir = path.normalize(certDir);

  // Construct the domain-specific path
  const domainCertPath = path.join(normalizedCertDir, domainName);

  // Resolve to absolute path and verify it's within certDir
  const resolvedDomainPath = path.resolve(domainCertPath);
  const resolvedCertDir = path.resolve(normalizedCertDir);

  if (!resolvedDomainPath.startsWith(resolvedCertDir + path.sep)) {
    throw new Error(
      `Domain certificate path escapes base directory: ${domainName}`
    );
  }

  return domainCertPath;
}
