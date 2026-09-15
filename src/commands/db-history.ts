import Table from 'cli-table3';
import chalk from 'chalk';
import { DatabaseRepo, MigrationRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';

export async function dbHistory(args: {
  name: string;
  key?: string;
}): Promise<void> {
  // Verify database exists
  const database = await DatabaseRepo.findByName(args.name);

  if (!args.key) {
    // List all migrations
    const migrations = await MigrationRepo.getAll(database.id);

    if (migrations.length === 0) {
      Logger.info(`No migrations found for database "${args.name}"`);
      return;
    }

    const table = new Table({
      head: ['KEY', 'TYPE', 'STATUS', 'BY', 'WHEN', 'STEPS'],
      colWidths: [25, 12, 15, 15, 20, 12],
    });

    for (const migration of migrations) {
      const statusColor =
        migration.status === 'succeeded'
          ? chalk.green
          : migration.status === 'failed'
          ? chalk.red
          : migration.status === 'running'
          ? chalk.yellow
          : chalk.gray;

      table.push([
        migration.migrationKey,
        migration.type,
        statusColor(migration.status),
        migration.performedBy,
        migration.createdAt.toISOString(),
        `${migration.completedSteps}/${migration.totalSteps}`,
      ]);
    }

    console.log(table.toString());
  } else {
    // Show detailed step-by-step breakdown
    const migration = await MigrationRepo.findByKey(database.id, args.key);

    if (!migration) {
      throw new Error(
        `Migration "${args.key}" not found for database "${args.name}"`
      );
    }

    const migrationWithSteps = await MigrationRepo.findById(migration.id);
    const steps = migrationWithSteps.steps || [];

    console.log(chalk.bold(`\nMigration: ${migration.migrationKey}`));
    console.log(`Type: ${migration.type}`);
    console.log(`Status: ${migration.status}`);
    console.log(`Performed by: ${migration.performedBy}`);
    console.log(`Created: ${migration.createdAt.toISOString()}`);
    console.log(`Steps: ${migration.completedSteps}/${migration.totalSteps}\n`);

    if (migration.error) {
      console.log(chalk.red(`Error: ${migration.error}\n`));
    }

    // Show steps
    const table = new Table({
      head: ['', 'STEP', 'DESCRIPTION', 'HAZARD', 'STATUS'],
      colWidths: [3, 6, 40, 12, 12],
    });

    for (const step of steps) {
      let glyph = '○'; // pending
      if (step.status === 'succeeded') glyph = chalk.green('✓');
      else if (step.status === 'failed') glyph = chalk.red('✗');
      else if (step.status === 'running') glyph = chalk.yellow('●');
      else if (step.status === 'skipped') glyph = chalk.gray('⊘');

      const hazardColor =
        step.hazardLevel === 'destructive'
          ? chalk.red
          : step.hazardLevel === 'warning'
          ? chalk.yellow
          : chalk.gray;

      table.push([
        glyph,
        step.stepIndex + 1,
        step.description,
        hazardColor(step.hazardLevel),
        step.status,
      ]);

      if (step.errorMessage) {
        table.push(['', '', chalk.red(`  → ${step.errorMessage}`), '', '']);
      }
    }

    console.log(table.toString());
  }
}
