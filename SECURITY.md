# Security Improvements

This document outlines the security enhancements implemented to protect against common attack vectors in the remote pusher and related components.

## Overview

The codebase now includes comprehensive security validation to prevent:
- Command injection attacks
- Path traversal vulnerabilities
- Race condition exploits
- SSH credential manipulation
- Unsafe file operations

## Security Validations Implemented

### 1. Domain Name Validation (`validateSafeDomainName`)

**Purpose**: Prevents malicious domain names from being used in file paths and shell commands.

**Protection Against**:
- Path traversal attempts (`../`, `~/`)
- Shell metacharacters (`;`, `|`, `&`, `` ` ``, `$`, etc.)
- Control characters and null bytes

**Usage**:
```typescript
validateSafeDomainName('example.com'); // ✓ Valid
validateSafeDomainName('../../etc/passwd'); // ✗ Throws error
validateSafeDomainName('example;rm -rf /'); // ✗ Throws error
```

**Applied In**:
- `RemotePusher` constructor
- `normalizeDomainFilename()` function

### 2. SSH Credentials Validation (`validateSshCredentials`)

**Purpose**: Ensures SSH connection strings are properly formatted and safe.

**Protection Against**:
- Shell metacharacter injection
- Invalid host/username formats
- Control characters in credentials

**Format**: `[username@]host`

**Usage**:
```typescript
validateSshCredentials('user@example.com'); // ✓ Valid
validateSshCredentials('root@192.168.1.1'); // ✓ Valid
validateSshCredentials('user@host;rm -rf /'); // ✗ Throws error
```

**Applied In**:
- `SshConnection` constructor

### 3. Certificate Path Validation (`validateCertPath`)

**Purpose**: Prevents path traversal attacks when constructing certificate/key paths.

**Protection Against**:
- Directory escaping attempts
- Malicious domain names used to access arbitrary files
- Path manipulation to write certs outside allowed directories

**Usage**:
```typescript
validateCertPath('/etc/ssl/certs', 'example.com'); // ✓ Returns safe path
validateCertPath('/etc/ssl/certs', '../../etc/passwd'); // ✗ Throws error
```

**Applied In**:
- `RemotePusher.remoteCertPath`
- `RemotePusher.remoteKeyPath`
- `LocalPusher.localCertPath`
- `LocalPusher.localKeyPath`
- `nginx-compiler.ts` cert path construction

### 4. Secure Temporary Filenames (`generateSecureTempFilename`)

**Purpose**: Generates unpredictable temporary filenames using cryptographic randomness.

**Protection Against**:
- Race condition attacks
- Predictable filename exploits
- Temporary file interception

**Old Approach** (Vulnerable):
```typescript
const tempFile = `/tmp/nginx-push-config-${Date.now()}.conf`;
// Predictable - attacker can guess timestamp
```

**New Approach** (Secure):
```typescript
const tempFile = `/tmp/${generateSecureTempFilename('nginx-push-config', 'conf')}`;
// Example: nginx-push-config-1718827400123-a3f5e8c9d2b1f4a6e7c8d9b0a1c2d3e4.conf
// Unpredictable due to crypto.randomBytes()
```

**Applied In**:
- `RemotePusher.transferConfigFile()`
- `RemotePusher.transferCertsIfApplicable()`
- `RemotePusher.restoreTarget()`

### 5. Safe Path Validation (`validateSafePath`)

**Purpose**: General-purpose path validation to ensure files remain within allowed directories.

**Protection Against**:
- Path traversal (`../`, `..\\`)
- Null byte injection
- Shell metacharacters in filenames

**Usage**:
```typescript
validateSafePath('config.conf', '/etc/nginx', 'Config file'); // ✓ Valid
validateSafePath('../../../etc/passwd', '/etc/nginx', 'Config file'); // ✗ Throws error
```

### 6. General String Safety (`validateSafeString`)

**Purpose**: Validates that strings don't contain shell metacharacters or control characters.

**Protection Against**:
- Command injection via any user-controlled string
- Control character attacks

## Shell Command Protection

### Existing Protection: `shellQuote()`

The codebase already uses `shellQuote()` to escape shell metacharacters:

```typescript
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
```

This wraps values in single quotes and escapes any embedded single quotes, which is the standard POSIX shell safe-quoting technique.

### Defense in Depth

The new validations provide **defense in depth** by:
1. Validating inputs before they're ever used
2. Preventing attacks even if `shellQuote()` is accidentally forgotten
3. Catching malicious inputs early with clear error messages
4. Preventing path traversal which `shellQuote()` doesn't address

## Security Validation Flow

```
User Input (Domain/Host/Path)
         ↓
   Validation Layer (NEW)
    - validateSafeDomainName()
    - validateSshCredentials()
    - validateCertPath()
         ↓
   Path Construction
         ↓
   Shell Quoting (EXISTING)
    - shellQuote()
         ↓
   Command Execution
```

## Updated Components

### Files Modified:
1. **`src/utils/security-validation.ts`** (NEW)
   - Comprehensive validation utilities

2. **`src/utils/remote-pusher.ts`**
   - Domain validation in constructor
   - Secure temp filenames
   - Path validation for certs

3. **`src/utils/ssh-connection.ts`**
   - SSH credential validation

4. **`src/utils/domain-push-utils.ts`**
   - Domain validation in normalization

5. **`src/utils/local-pusher.ts`**
   - Cert path validation

6. **`src/utils/nginx-compiler.ts`**
   - Cert path validation

## Testing Security

### Manual Testing

Test various attack vectors to ensure they're blocked:

```bash
# Command injection attempts
dm domain add "example.com; rm -rf /"
dm domain add "example.com | cat /etc/passwd"
dm domain add "example.com && malicious-command"

# Path traversal attempts
dm domain add "../../etc/passwd"
dm domain add "../../../root/.ssh/id_rsa"
dm domain add "~/../../etc/shadow"

# Control characters
dm domain add $'example.com\x00malicious'
dm domain add $'example.com\nmalicious'

# All should fail with clear error messages
```

### Expected Behavior

All malicious inputs should be **rejected at the validation layer** with descriptive error messages:

```
Error: Domain name contains unsafe shell metacharacters
Error: Domain name contains path traversal characters
Error: Domain certificate path escapes base directory
```

## Best Practices for Developers

1. **Always validate user input** before using it in:
   - File paths
   - Shell commands
   - Database queries
   - SSH operations

2. **Use the validation utilities**:
   ```typescript
   import { validateSafeDomainName, validateCertPath } from './security-validation.js';
   ```

3. **Continue using `shellQuote()`** for all shell interpolations

4. **Use `generateSecureTempFilename()`** instead of predictable names

5. **Review new code paths** that accept user input

## Remaining Considerations

### Low Priority Items:
1. Consider adding rate limiting for push operations
2. Implement audit logging for security-sensitive operations
3. Add certificate pinning for SSH connections (advanced)
4. Consider adding a dry-run mode for push operations

### Already Secure:
- Password redaction in error messages ✓
- SSH key authentication support ✓
- Sudo password handling via stdin ✓
- Proper file permissions (handled by OS) ✓

## Vulnerability Disclosure

If you discover a security vulnerability, please report it to the maintainers privately rather than opening a public issue.

## Changelog

### 2024-06 - Security Hardening
- Added comprehensive input validation
- Implemented cryptographically secure temp filenames
- Added path traversal protection
- Enhanced SSH credential validation
- Added defense-in-depth for command injection
