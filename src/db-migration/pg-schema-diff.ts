import { execa } from 'execa';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolvePgSchemaDiffBinary } from './binary.js';
import { DatabaseRepo } from '../db/repos.js';
import { Plan, PlanStep } from './plan-types.js';
import { DB_COMPARE_USER, DB_COMPARE_PASSWORD } from '../constants.js';

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
    const dsn = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${details.host}:${details.port}/${details.database}?sslmode=${details.sslMode}`;

    // Create temp directory for desired schema
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-schema-'));
    const schemaFile = path.join(tmpDir, 'schema.sql');
    fs.writeFileSync(schemaFile, desiredSchemaSql, 'utf8');

    try {
      // Get binary path
      const binaryPath = resolvePgSchemaDiffBinary();

      // Execute pg-schema-diff
      const result = await execa(binaryPath, [
        'plan',
        '--from-dsn',
        dsn,
        '--to-dir',
        tmpDir,
        '--output-format',
        'json',
      ]);

      // DEBUG: Write raw output to file for debugging
      try {
        fs.writeFileSync('debug-pg-schema-diff-raw.json', result.stdout, 'utf8');
      } catch (debugErr) {
        // Ignore debug write errors
      }

      // Parse JSON output
      const output = JSON.parse(result.stdout);

      // Map pg-schema-diff output to Plan interface
      const steps: PlanStep[] = [];
      let warningCount = 0;
      let destructiveCount = 0;

      if (output.statements && Array.isArray(output.statements)) {
        for (let i = 0; i < output.statements.length; i++) {
          const stmt = output.statements[i];

          // Determine hazard level based on pg-schema-diff metadata
          let hazardLevel: 'none' | 'warning' | 'destructive' = 'none';
          const upperSql = stmt.sql?.toUpperCase() || '';

          if (
            stmt.hazard === 'high' ||
            upperSql.includes('DROP') ||
            upperSql.includes('TRUNCATE')
          ) {
            hazardLevel = 'destructive';
            destructiveCount++;
          } else if (
            stmt.hazard === 'medium' ||
            upperSql.includes('ALTER') ||
            upperSql.includes('CREATE INDEX')
          ) {
            hazardLevel = 'warning';
            warningCount++;
          }

          // Determine if transactional
          const transactional = !upperSql.includes('CONCURRENTLY');

          steps.push({
            index: i,
            description: stmt.description || stmt.sql?.substring(0, 50) || '',
            sql: stmt.sql || '',
            hazardLevel,
            transactional,
          });
        }
      }

      return {
        steps,
        stats: {
          totalSteps: steps.length,
          warnings: warningCount,
          destructive: destructiveCount,
        },
      };
    } finally {
      // Clean up temp directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
