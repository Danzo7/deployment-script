import fs from 'fs';
import path from 'path';
import { PG_SCHEMA_DIFF_DIR } from '../constants.js';

export function resolvePgSchemaDiffBinary(): string {
  // Platform-specific binary name
  const binaryName =
    process.platform === 'win32' ? 'pg-schema-diff.exe' : 'pg-schema-diff';

  const binaryPath = path.join(PG_SCHEMA_DIFF_DIR, binaryName);

  // Check if binary exists
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `pg-schema-diff binary not found at: ${binaryPath}\n\n` +
        `Please download and install pg-schema-diff from:\n` +
        `https://github.com/stripe/pg-schema-diff/releases\n\n` +
        `Extract the binary to: ${PG_SCHEMA_DIFF_DIR}`
    );
  }

  // Check if executable (Unix only)
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
      throw new Error(
        `pg-schema-diff binary at ${binaryPath} is not executable.\n` +
          `Run: chmod +x ${binaryPath}`
      );
    }
  }

  return binaryPath;
}
