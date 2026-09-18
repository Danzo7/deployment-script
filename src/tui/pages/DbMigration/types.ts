import { Plan } from '../../../db-migration/plan-types.js';

export type ScreenFlow =
  | 'type-select'
  | 'schema-editor'
  | 'plan-review'
  | 'manual-review'
  | 'data-review'
  | 'progress'
  | 'done';

export type MigrationType = 'generated' | 'manual' | 'data';

export interface DbMigrationState {
  dbName: string;
  migrationKey?: string;
  migrationType?: MigrationType;
  schemaText: string;
  plan?: Plan;
  migrationId?: string | number;
  error?: string;
}

export interface TypeSelectScreenProps {
  onSelect: (type: MigrationType) => void;
  onCancel: () => void;
}

export interface SchemaEditorProps {
  dbName: string;
  initialText: string;
  mode: 'generated' | 'manual' | 'data';
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onBack?: () => void;
}

export interface PlanReviewScreenProps {
  dbName: string;
  plan: Plan;
  mode: 'compare' | 'migrate';
  migrationKey?: string;
  onExecute?: (key: string) => void;
  onBack?: () => void;
  onCancel: () => void;
}

export interface ManualReviewScreenProps {
  dbName: string;
  sql: string;
  migrationKey?: string;
  onExecute: (key: string) => void;
  onBack: () => void;
  onCancel: () => void;
}

export interface DataReviewScreenProps {
  dbName: string;
  sql: string;
  migrationKey?: string;
  onExecute: (key: string) => void;
  onBack: () => void;
  onCancel: () => void;
}

export interface ProgressScreenProps {
  migrationId: string | number;
  onComplete: () => void;
}
