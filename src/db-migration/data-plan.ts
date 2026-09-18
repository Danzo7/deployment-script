import { Plan, PlanStep } from './plan-types.js';

export function buildDataPlan(sql: string): Plan {
  // Split SQL by semicolons, handling multi-line statements
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const steps: PlanStep[] = [];
  let warningCount = 0;
  let destructiveCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const upperStatement = statement.toUpperCase();

    // Block DDL operations - data migrations should only modify data
    if (
      upperStatement.includes('CREATE TABLE') ||
      upperStatement.includes('DROP TABLE') ||
      upperStatement.includes('ALTER TABLE') ||
      upperStatement.includes('CREATE INDEX') ||
      upperStatement.includes('DROP INDEX') ||
      upperStatement.includes('CREATE SCHEMA') ||
      upperStatement.includes('DROP SCHEMA') ||
      upperStatement.includes('CREATE DATABASE') ||
      upperStatement.includes('DROP DATABASE') ||
      upperStatement.includes('ALTER DATABASE') ||
      upperStatement.includes('RENAME DATABASE') ||
      /\bDATABASE\s+\w+\s+RENAME\s+TO\b/i.test(statement)
    ) {
      throw new Error('Schema-level operations (CREATE/DROP/ALTER TABLE, INDEX, etc.) are not allowed in data migrations. Use manual or generated migrations for schema changes.');
    }

    // Detect hazard level for data operations
    let hazardLevel: 'none' | 'warning' | 'destructive' = 'none';
    const transactional = true;

    // Destructive data operations
    if (upperStatement.includes('TRUNCATE')) {
      hazardLevel = 'destructive';
      destructiveCount++;
    }
    // DELETE/UPDATE without WHERE clause
    else if (
      (upperStatement.startsWith('DELETE') || upperStatement.startsWith('UPDATE')) &&
      !upperStatement.includes('WHERE')
    ) {
      hazardLevel = 'destructive';
      destructiveCount++;
    }
    // DELETE/UPDATE with WHERE (careful but less destructive)
    else if (
      upperStatement.startsWith('DELETE') ||
      upperStatement.startsWith('UPDATE')
    ) {
      hazardLevel = 'warning';
      warningCount++;
    }
    // INSERT is generally safe
    else if (upperStatement.startsWith('INSERT')) {
      hazardLevel = 'none';
    }

    // Create description from first 50 chars
    const description =
      statement.length > 50 ? statement.substring(0, 50) + '...' : statement;

    steps.push({
      index: i,
      description,
      sql: statement,
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
