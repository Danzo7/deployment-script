import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { TypeSelectScreen } from './components/TypeSelectScreen.js';
import { SchemaEditor } from './components/SchemaEditor.js';
import { PlanReviewScreen } from './components/PlanReviewScreen.js';
import { ManualReviewScreen } from './components/ManualReviewScreen.js';
import { ProgressScreen } from './components/ProgressScreen.js';
import { DbSchemaDiff } from '../../../db-migration/pg-schema-diff.js';
import { buildManualPlan } from '../../../db-migration/manual-plan.js';
import { executeManualMigration, executeGeneratedMigration } from '../../../db-migration/migration-engine.js';
import { Plan } from '../../../db-migration/plan-types.js';
import { MigrationType, ScreenFlow } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// DbCompareScreen - Read-only schema comparison
// ═══════════════════════════════════════════════════════════════════════════

interface DbCompareScreenProps {
  dbName: string;
}

export const DbCompareScreen: React.FC<DbCompareScreenProps> = ({ dbName }) => {
  const [screen, setScreen] = useState<ScreenFlow>('schema-editor');
  const [schemaText, setSchemaText] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { exit } = useApp();

  const handleSchemaSubmit = async (text: string) => {
    setSchemaText(text);
    
    try {
      // Generate diff plan
      const differ = new DbSchemaDiff(dbName);
      const generatedPlan = await differ.compare(text);
      setPlan(generatedPlan);
      setScreen('plan-review');
    } catch (err: any) {
      setError(err.message || String(err));
      // Show error and exit
      exit();
    }
  };

  const handleCancel = () => {
    exit();
  };

  if (error) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (screen === 'schema-editor') {
    return (
      <SchemaEditor
        dbName={dbName}
        initialText={schemaText}
        mode="generated"
        onSubmit={handleSchemaSubmit}
        onCancel={handleCancel}
      />
    );
  }

  if (screen === 'plan-review' && plan) {
    return (
      <PlanReviewScreen
        dbName={dbName}
        plan={plan}
        mode="compare"
        onBack={() => setScreen('schema-editor')}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Unknown screen state</Text>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// DbMigrateScreen - Full migration workflow with execution
// ═══════════════════════════════════════════════════════════════════════════

interface DbMigrateScreenProps {
  dbName: string;
  migrationKey: string;
  migrationType?: MigrationType;
  initialText?: string;
}

export const DbMigrateScreen: React.FC<DbMigrateScreenProps> = ({
  dbName,
  migrationKey: initialMigrationKey,
  migrationType: initialType,
  initialText = '',
}) => {
  const [screen, setScreen] = useState<ScreenFlow>(
    initialType ? 'schema-editor' : 'type-select'
  );
  const [migrationType, setMigrationType] = useState<MigrationType | undefined>(initialType);
  const [schemaText, setSchemaText] = useState(initialText);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [migrationKey, setMigrationKey] = useState(initialMigrationKey);
  const [migrationId, setMigrationId] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { exit } = useApp();

  const handleTypeSelect = (type: MigrationType) => {
    setMigrationType(type);
    setScreen('schema-editor');
  };

  const handleSchemaSubmit = async (text: string) => {
    setSchemaText(text);

    try {
      if (migrationType === 'generated') {
        // Generate diff plan
        const differ = new DbSchemaDiff(dbName);
        const generatedPlan = await differ.compare(text);
        setPlan(generatedPlan);
        setScreen('plan-review');
      } else {
        // Manual migration - build basic plan for review
        const manualPlan = buildManualPlan(text);
        setPlan(manualPlan);
        setScreen('manual-review');
      }
    } catch (err: any) {
      setError(err.message || String(err));
      exit();
    }
  };

  const handleExecute = async (key: string) => {
    setMigrationKey(key);

    try {
      let migration;
      if (migrationType === 'generated') {
        migration = await executeGeneratedMigration(dbName, key, schemaText);
      } else {
        migration = await executeManualMigration(dbName, key, schemaText);
      }

      setMigrationId(migration.id);
      setScreen('progress');
    } catch (err: any) {
      setError(err.message || String(err));
      exit();
    }
  };

  const handleComplete = () => {
    exit();
  };

  const handleCancel = () => {
    exit();
  };

  if (error) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (screen === 'type-select') {
    return (
      <TypeSelectScreen
        onSelect={handleTypeSelect}
        onCancel={handleCancel}
      />
    );
  }

  if (screen === 'schema-editor') {
    return (
      <SchemaEditor
        dbName={dbName}
        initialText={schemaText}
        mode={migrationType || 'generated'}
        onSubmit={handleSchemaSubmit}
        onCancel={handleCancel}
      />
    );
  }

  if (screen === 'plan-review' && plan) {
    return (
      <PlanReviewScreen
        dbName={dbName}
        plan={plan}
        mode="migrate"
        migrationKey={migrationKey}
        onExecute={handleExecute}
        onBack={() => setScreen('schema-editor')}
        onCancel={handleCancel}
      />
    );
  }

  if (screen === 'manual-review' && plan) {
    return (
      <ManualReviewScreen
        dbName={dbName}
        sql={schemaText}
        migrationKey={migrationKey}
        onExecute={handleExecute}
        onBack={() => setScreen('schema-editor')}
        onCancel={handleCancel}
      />
    );
  }

  if (screen === 'progress' && migrationId) {
    return (
      <ProgressScreen
        migrationId={migrationId}
        onComplete={handleComplete}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Unknown screen state</Text>
    </Box>
  );
};
