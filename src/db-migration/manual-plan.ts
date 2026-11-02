import type { Plan } from './plan-types.js';
import {
  parseSqlStatements,
  assertManualStatement,
  statementHazard,
  isTransactional,
} from './sql-statements.js';

export function buildManualPlan(sql: string): Plan {
  const steps = parseSqlStatements(sql).map((statement, index) => {
    assertManualStatement(statement);
    return {
      index,
      description:
        statement.sql.length > 50
          ? statement.sql.substring(0, 50) + '...'
          : statement.sql,
      sql: statement.sql,
      hazardLevel: statementHazard(statement),
      transactional: isTransactional(statement),
    };
  });
  return {
    steps,
    stats: {
      totalSteps: steps.length,
      warnings: steps.filter((step) => step.hazardLevel === 'warning').length,
      destructive: steps.filter((step) => step.hazardLevel === 'destructive')
        .length,
    },
  };
}
