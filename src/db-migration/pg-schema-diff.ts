import { execa } from 'execa';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'path';
import os from 'os';
import { resolvePgSchemaDiffBinary } from './binary.js';
import { DatabaseRepo } from '../db/repos.js';
import { Plan, PlanStep } from './plan-types.js';
import { DB_COMPARE_USER, DB_COMPARE_PASSWORD } from '../constants.js';

// Type definitions matching pg-schema-diff JSON output
interface MigrationHazard {
  type: string;
  message: string;
}

interface Statement {
  ddl: string;
  timeout_ms: number;
  lock_timeout_ms: number;
  hazards: MigrationHazard[];
}

interface PgSchemaDiffPlan {
  statements: Statement[];
  current_schema_hash: string;
}

// Hazard types that indicate data loss or destructive operations
// These are the only ones we classify as "destructive" in the UI
// Other hazards (locks, performance issues) are classified as "warning"
const DESTRUCTIVE_HAZARDS = new Set([
  'DELETES_DATA',
  'CORRECTNESS',
]);

class DbSchemaDiffError extends Error {
  cause?: unknown;
  
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'DbSchemaDiffError';
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

function mapSchemaDiffPlan(output: PgSchemaDiffPlan): Plan {
  const steps: PlanStep[] = [];
  let warningCount = 0;
  let destructiveCount = 0;

  for (let i = 0; i < output.statements.length; i++) {
    const stmt = output.statements[i];
    const sql = stmt.ddl || '';

    // Determine hazard level based on pg-schema-diff hazards
    let hazardLevel: 'none' | 'warning' | 'destructive' = 'none';
    
    if (stmt.hazards && stmt.hazards.length > 0) {
      // Check for destructive hazards (data loss)
      const hasDestructiveHazard = stmt.hazards.some((h: MigrationHazard) =>
        DESTRUCTIVE_HAZARDS.has(h.type)
      );
      
      if (hasDestructiveHazard) {
        hazardLevel = 'destructive';
        destructiveCount++;
      } else {
        // Has hazards but none are destructive - treat as warning
        hazardLevel = 'warning';
        warningCount++;
      }
    }

    // Determine if transactional (concurrent operations cannot be in transactions)
    const transactional = !sql.toUpperCase().includes('CONCURRENTLY');

    // Create description from the first hazard message or SQL
    let description = '';
    if (stmt.hazards && stmt.hazards.length > 0) {
      description = stmt.hazards[0].message || sql.substring(0, 50);
    } else {
      description = sql.substring(0, 50);
    }

    steps.push({
      index: i,
      description,
      sql,
      hazardLevel,
      transactional,
    });
  }

  return {
    steps,
    stats: {
      totalSteps: steps.length,
      warnings: warningCount,
      destructive: destructiveCount,
    },
  };
}

export class DbSchemaDiff {
  private dbName: string;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  async compare(desiredSchemaSql: string): Promise<Plan> {
    // Get connection details
    const details = await DatabaseRepo.getConnectionDetails(this.dbName);

    // Use compare credentials if available, otherwise fall back to regular credentials
    const username = DB_COMPARE_USER || details.username;
    const password = DB_COMPARE_PASSWORD || details.password;

    // Build PostgreSQL DSN string
    // Note: Password is in the DSN string - ensure this never appears in logs
    const dsn = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${details.host}:${details.port}/${details.database}?sslmode=${details.sslMode}`;

    // Create temp directory for desired schema
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dm-schema-'));
    
    try {
      const schemaFile = path.join(tmpDir, 'schema.sql');
      await writeFile(schemaFile, desiredSchemaSql, 'utf8');

      // Get binary path
      const binaryPath = resolvePgSchemaDiffBinary();

      // Execute pg-schema-diff
      let result;
      try {
        result = await execa(binaryPath, [
          'plan',
          '--from-dsn',
          dsn,
          '--to-dir',
          tmpDir,
          '--output-format',
          'json',
        ]);
      } catch (error) {
        throw new DbSchemaDiffError(
          `Failed to generate database schema migration plan for database "${this.dbName}"`,
          { cause: error }
        );
      }

      // Parse JSON output
      let output: PgSchemaDiffPlan;
      try {
        output = JSON.parse(result.stdout);
      } catch (error) {
        throw new DbSchemaDiffError(
          'Failed to parse pg-schema-diff output',
          { cause: error }
        );
      }

      // Validate basic structure
      if (!output.statements || !Array.isArray(output.statements)) {
        throw new DbSchemaDiffError(
          'Invalid pg-schema-diff output: missing or invalid statements array'
        );
      }

      return mapSchemaDiffPlan(output);
    } finally {
      // Clean up temp directory
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}