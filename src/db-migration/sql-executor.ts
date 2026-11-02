import { Connector } from './connector.js';
import { Plan, PlanStep } from './plan-types.js';

export async function executePlan(
  connector: Connector,
  plan: Plan,
  onStepUpdate: (
    stepIndex: number,
    status: 'running' | 'succeeded' | 'failed' | 'skipped',
    error?: string
  ) => Promise<void>
): Promise<{ succeededSteps: number[]; failedStep?: number }> {
  const succeededSteps: number[] = [];

  // Group consecutive transactional steps
  const groups: { steps: PlanStep[]; transactional: boolean }[] = [];
  let currentGroup: PlanStep[] = [];
  let currentTransactional = true;

  for (const step of plan.steps) {
    if (step.transactional === currentTransactional) {
      currentGroup.push(step);
    } else {
      if (currentGroup.length > 0) {
        groups.push({ steps: currentGroup, transactional: currentTransactional });
      }
      currentGroup = [step];
      currentTransactional = step.transactional;
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ steps: currentGroup, transactional: currentTransactional });
  }

  // Execute each group
  for (const group of groups) {
    if (group.transactional) {
      let failedStep = group.steps[0].index;
      try {
        await connector.query('BEGIN');
        for (const step of group.steps) {
          failedStep = step.index;
          await onStepUpdate(step.index, 'running');
          // Keep server parsing consistent with the SQL lexer's string handling.
          await connector.query('SET standard_conforming_strings = on');
          await connector.query(step.sql);
        }
        await connector.query('COMMIT');
      } catch (err: any) {
        let rollbackError: string | undefined;
        try {
          await connector.query('ROLLBACK');
        } catch (rollbackErr: any) {
          rollbackError = rollbackErr.message || String(rollbackErr);
        }
        const message = err.message || String(err);
        for (const step of group.steps) {
          await onStepUpdate(step.index, step.index === failedStep ? 'failed' : 'skipped',
            rollbackError ? `${message}; rollback could not be confirmed: ${rollbackError}` :
              step.index === failedStep ? message : 'Transaction rolled back; no changes committed.');
        }
        for (const step of plan.steps.filter(s => s.index > group.steps[group.steps.length - 1].index)) {
          await onStepUpdate(step.index, 'skipped');
        }
        return { succeededSteps, failedStep };
      }
      // The transaction has committed. Reporting errors must not trigger rollback.
      for (const step of group.steps) {
        succeededSteps.push(step.index);
        await onStepUpdate(step.index, 'succeeded');
      }
    } else {
      // Execute non-transactional steps outside transaction
      for (const step of group.steps) {
        try {
          await onStepUpdate(step.index, 'running');
          await connector.query('SET standard_conforming_strings = on');
          await connector.query(step.sql);
          await onStepUpdate(step.index, 'succeeded');
          succeededSteps.push(step.index);
        } catch (err: any) {
          await onStepUpdate(step.index, 'failed', err.message || String(err));
          for (const remaining of plan.steps.filter(s => s.index > step.index)) {
            await onStepUpdate(remaining.index, 'skipped');
          }
          return { succeededSteps, failedStep: step.index };
        }
      }
    }
  }

  return { succeededSteps };
}
