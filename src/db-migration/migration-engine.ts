import crypto from 'crypto';
import { Connector } from './connector.js';
import { MigrationRepo } from '../db/repos.js';
import { DatabaseRepo } from '../db/repos.js';
import { buildManualPlan } from './manual-plan.js';
import { executePlan } from './sql-executor.js';
import { getCurrentUser } from '../utils/user-context.js';
import { Migration } from '../db/model.js';

export async function executeManualMigration(
  dbName: string,
  migrationKey: string,
  sql: string
): Promise<Migration> {
  // Build plan
  const plan = buildManualPlan(sql);

  // Compute content hash
  const contentHash = crypto.createHash('sha256').update(sql).digest('hex');

  // Get database ID
  const database = await DatabaseRepo.findByName(dbName);

  // Check if migration with same key already exists
  const existing = await MigrationRepo.findByKey(database.id, migrationKey);
  if (existing) {
    throw new Error(
      `Migration with key "${migrationKey}" already exists for database "${dbName}"`
    );
  }

  // Create migration row
  const migration = await MigrationRepo.create({
    databaseId: database.id,
    migrationKey,
    contentHash,
    type: 'manual',
    sourceText: sql,
    plan,
    totalSteps: plan.stats.totalSteps,
    performedBy: getCurrentUser(),
  });

  // Create migration_step rows
  for (const step of plan.steps) {
    await MigrationRepo.addStep(migration.id, {
      stepIndex: step.index,
      description: step.description,
      sql: step.sql,
      hazardLevel: step.hazardLevel,
    });
  }

  // Start execution in background - do not await
  executeInBackground(migration.id, dbName, plan);

  // Return migration record immediately so UI can start polling
  return await MigrationRepo.findById(migration.id);
}

async function executeInBackground(migrationId: string | number, dbName: string, plan: any): Promise<void> {
  const connector = new Connector(dbName);
  
  try {
    await connector.connect();
    
    // Update migration status to running
    await MigrationRepo.updateStatus(migrationId, 'running');

    // Get the migration with steps to get step IDs
    const migrationWithSteps = await MigrationRepo.findById(migrationId);
    const steps = migrationWithSteps.steps || [];

    // Execute plan with onStepUpdate callback
    const result = await executePlan(connector, plan, async (stepIndex, status, error) => {
      const step = steps.find((s) => s.stepIndex === stepIndex);
      if (step) {
        await MigrationRepo.updateStepStatus(step.id, status, error);
      }

      // Update migration completedSteps count
      if (status === 'succeeded') {
        const succeededCount = steps.filter(
          (s) => s.stepIndex <= stepIndex
        ).length;
        await MigrationRepo.updateStatus(
          migrationId,
          'running',
          succeededCount
        );
      }
    });

    // Update migration status based on result
    if (result.failedStep !== undefined) {
      await MigrationRepo.updateStatus(
        migrationId,
        'failed',
        result.succeededSteps.length,
        `Migration failed at step ${result.failedStep}`
      );
    } else {
      await MigrationRepo.updateStatus(
        migrationId,
        'succeeded',
        plan.stats.totalSteps
      );
    }
  } catch (err: any) {
    await MigrationRepo.updateStatus(
      migrationId,
      'failed',
      undefined,
      err.message || String(err)
    );
  } finally {
    await connector.close();
  }
}


export async function executeGeneratedMigration(
  dbName: string,
  migrationKey: string,
  desiredSchemaSql: string
): Promise<Migration> {
  // Import DbSchemaDiff dynamically to avoid circular dependency
  const { DbSchemaDiff } = await import('./pg-schema-diff.js');

  // Create DbSchemaDiff instance and call compare()
  const differ = new DbSchemaDiff(dbName);
  const plan = await differ.compare(desiredSchemaSql);

  // Compute content hash
  const contentHash = crypto
    .createHash('sha256')
    .update(desiredSchemaSql)
    .digest('hex');

  // Get database ID
  const database = await DatabaseRepo.findByName(dbName);

  // Check if migration with same key already exists
  const existing = await MigrationRepo.findByKey(database.id, migrationKey);
  if (existing) {
    throw new Error(
      `Migration with key "${migrationKey}" already exists for database "${dbName}"`
    );
  }

  // Create migration row
  const migration = await MigrationRepo.create({
    databaseId: database.id,
    migrationKey,
    contentHash,
    type: 'generated',
    sourceText: desiredSchemaSql,
    plan,
    totalSteps: plan.stats.totalSteps,
    performedBy: getCurrentUser(),
  });

  // Create migration_step rows
  for (const step of plan.steps) {
    await MigrationRepo.addStep(migration.id, {
      stepIndex: step.index,
      description: step.description,
      sql: step.sql,
      hazardLevel: step.hazardLevel,
    });
  }

  // Start execution in background - do not await
  executeInBackground(migration.id, dbName, plan);

  // Return migration record immediately so UI can start polling
  return await MigrationRepo.findById(migration.id);
}
