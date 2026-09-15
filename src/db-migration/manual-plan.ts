import { Plan, PlanStep } from './plan-types.js';

export function buildManualPlan(sql: string): Plan {
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

    // Block all database-level operations - not allowed in manual migrations
    if (
      upperStatement.includes('CREATE DATABASE') ||
      upperStatement.includes('DROP DATABASE') ||
      upperStatement.includes('ALTER DATABASE') ||
      upperStatement.includes('RENAME DATABASE') ||
      /\bDATABASE\s+\w+\s+RENAME\s+TO\b/i.test(statement)
    ) {
      throw new Error('Database-level operations (CREATE DATABASE, DROP DATABASE, ALTER DATABASE) are not allowed in manual migrations');
    }

    // Detect hazard level
    let hazardLevel: 'none' | 'warning' | 'destructive' = 'none';
    let transactional = true;

    // Destructive patterns (database-level operations already blocked above)
    if (
      upperStatement.includes('DROP TABLE') ||
      upperStatement.includes('DROP SCHEMA') ||
      upperStatement.includes('DROP INDEX') ||
      upperStatement.includes('TRUNCATE')
    ) {
      hazardLevel = 'destructive';
      destructiveCount++;
    }
    // DELETE/UPDATE without WHERE clause (simplified check)
    else if (
      (upperStatement.startsWith('DELETE') || upperStatement.startsWith('UPDATE')) &&
      !upperStatement.includes('WHERE')
    ) {
      hazardLevel = 'destructive';
      destructiveCount++;
    }
    // Warning patterns
    else if (upperStatement.includes('CREATE INDEX CONCURRENTLY')) {
      hazardLevel = 'warning';
      warningCount++;
      transactional = false; // CONCURRENTLY cannot run in transaction
    } else if (
      upperStatement.includes('ALTER TABLE') ||
      upperStatement.includes('CREATE INDEX')
    ) {
      hazardLevel = 'warning';
      warningCount++;
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
