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
      // Execute transaction group
      try {
        await connector.query('BEGIN');

        for (const step of group.steps) {
          try {
            await onStepUpdate(step.index, 'running');
            await connector.query(step.sql);
            await onStepUpdate(step.index, 'succeeded');
            succeededSteps.push(step.index);
          } catch (err: any) {
            await connector.query('ROLLBACK');
            await onStepUpdate(step.index, 'failed', err.message || String(err));
            
            // Mark remaining steps in transaction as skipped
            const remainingSteps = group.steps.filter((s) => s.index > step.index);
            for (const skippedStep of remainingSteps) {
              await onStepUpdate(skippedStep.index, 'skipped');
            }
            
            return { succeededSteps, failedStep: step.index };
          }
        }

        await connector.query('COMMIT');
      } catch (err: any) {
        // Transaction failed
        try {
          await connector.query('ROLLBACK');
        } catch {}
        return { succeededSteps, failedStep: group.steps[0].index };
      }
    } else {
      // Execute non-transactional steps outside transaction
      for (const step of group.steps) {
        try {
          await onStepUpdate(step.index, 'running');
          await connector.query(step.sql);
          await onStepUpdate(step.index, 'succeeded');
          succeededSteps.push(step.index);
        } catch (err: any) {
          await onStepUpdate(step.index, 'failed', err.message || String(err));
          return { succeededSteps, failedStep: step.index };
        }
      }
    }
  }

  return { succeededSteps };
}
