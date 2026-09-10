import crypto from "crypto";
import path from "path";
function validateSafeString(value, fieldName) {
  if (!value || value.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  const dangerousChars = /[;&|`$()<>\\'"!\s\u0000-\u001F\u007F]/;
  if (dangerousChars.test(value)) {
    throw new Error(
      `${fieldName} contains unsafe characters. Only alphanumeric, dots, hyphens, and underscores are allowed.`
    );
  }
  const injectionPatterns = /(\.\.\/|\.\.\\|~\/|~\\)/;
  if (injectionPatterns.test(value)) {
    throw new Error(
      `${fieldName} contains potentially malicious path traversal patterns`
    );
  }
}
function validateSafeDomainName(domainName) {
  if (!domainName || domainName.length === 0) {
    throw new Error("Domain name cannot be empty");
  }
  if (domainName.length > 253) {
    throw new Error("Domain name exceeds maximum length of 253 characters");
  }
  if (domainName.includes("..") || domainName.includes("~")) {
    throw new Error("Domain name contains path traversal characters");
  }
  const dangerousChars = /[;&|`$()<>\\'"!\s\u0000-\u001F\u007F]/;
  if (dangerousChars.test(domainName)) {
    throw new Error("Domain name contains unsafe shell metacharacters");
  }
  const labels = domainName.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new Error(
        `Domain label "${label}" must be between 1 and 63 characters`
      );
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      throw new Error(
        `Domain label "${label}" cannot start or end with a hyphen`
      );
    }
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      throw new Error(`Domain label "${label}" contains invalid characters`);
    }
  }
}
function validateSafePath(filePath, baseDir, fieldName) {
  if (!filePath || filePath.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  const normalizedPath = path.normalize(filePath);
  const normalizedBase = path.normalize(baseDir);
  const resolvedPath = path.resolve(normalizedBase, normalizedPath);
  const resolvedBase = path.resolve(normalizedBase);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error(
      `${fieldName} attempts to escape base directory: ${filePath}`
    );
  }
  if (filePath.includes("\0")) {
    throw new Error(`${fieldName} contains null byte`);
  }
  const filename = path.basename(filePath);
  const dangerousChars = /[;&|`$()<>\\'"!\u0000-\u001F\u007F]/;
  if (dangerousChars.test(filename)) {
    throw new Error(`${fieldName} filename contains unsafe characters`);
  }
}
function validateSshCredentials(remoteHost) {
  if (!remoteHost || remoteHost.length === 0) {
    throw new Error("Remote host cannot be empty");
  }
  const dangerousChars = /[;&|`$()<>\\'"!\u0000-\u001F\u007F]/;
  if (dangerousChars.test(remoteHost)) {
    throw new Error("Remote host contains unsafe shell metacharacters");
  }
  const parts = remoteHost.split("@");
  if (parts.length > 2) {
    throw new Error("Invalid remote host format. Expected: [user@]host");
  }
  if (parts.length === 2) {
    const [username, host] = parts;
    if (!username || username.length === 0) {
      throw new Error("Username cannot be empty");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new Error(
        "Username contains invalid characters. Only alphanumeric, underscore, and hyphen allowed."
      );
    }
    validateHostPart(host);
  } else {
    validateHostPart(parts[0]);
  }
}
function validateHostPart(host) {
  if (!host || host.length === 0) {
    throw new Error("Host cannot be empty");
  }
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = host.match(ipv4Pattern);
  if (ipv4Match) {
    const valid = ipv4Match.slice(1).every((octet) => {
      const n = parseInt(octet, 10);
      return n >= 0 && n <= 255;
    });
    if (!valid) {
      throw new Error("Invalid IPv4 address");
    }
    return;
  }
  const labels = host.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      throw new Error(
        `Host label "${label}" must be between 1 and 63 characters`
      );
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      throw new Error(
        `Host label "${label}" cannot start or end with a hyphen`
      );
    }
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      throw new Error(`Host label "${label}" contains invalid characters`);
    }
  }
}
function generateSecureTempFilename(prefix, extension) {
  const randomBytes = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now();
  return `${prefix}-${timestamp}-${randomBytes}.${extension}`;
}
function validateCertPath(certDir, domainName) {
  if (!certDir || certDir.length === 0) {
    throw new Error("Certificate directory cannot be empty");
  }
  validateSafeDomainName(domainName);
  const normalizedCertDir = path.normalize(certDir);
  const domainCertPath = path.join(normalizedCertDir, domainName);
  const resolvedDomainPath = path.resolve(domainCertPath);
  const resolvedCertDir = path.resolve(normalizedCertDir);
  if (!resolvedDomainPath.startsWith(resolvedCertDir + path.sep)) {
    throw new Error(
      `Domain certificate path escapes base directory: ${domainName}`
    );
  }
  return domainCertPath;
}
export {
  generateSecureTempFilename,
  validateCertPath,
  validateSafeDomainName,
  validateSafePath,
  validateSafeString,
  validateSshCredentials
};
