import React from 'react';
import { EnvEntry } from '../../../utils/env-file-parser.js';
import {
  KeyValueEditor,
  type EditorRow,
  type RowState,
  type KeyValueEditorConfig,
} from '../../components/editors/KeyValueEditor.js';
import { isValidEnvKey, isSecret, maskValue } from '../../utils/editor-helpers.js';

// Re-export types
export type { RowState, EditorRow };

interface EnvEditorProps {
  appName: string;
  initial: EnvEntry[];
  onSave: (rows: EditorRow[], count: number) => Promise<void>;
}

export function EnvEditor({
  appName,
  initial,
  onSave,
}: EnvEditorProps): React.ReactElement {
  // Convert EnvEntry[] to Record<string, string>
  const initialRecord = initial.reduce(
    (acc, { key, value }) => {
      acc[key] = value;
      return acc;
    },
    {} as Record<string, string>
  );

  const config: KeyValueEditorConfig = {
    targetName: appName,
    editorLabel: 'dm env',
    keyLabel: 'KEY',
    valueLabel: 'VALUE',
    keyPlaceholder: 'NEW_VAR_NAME',
    transformKey: (key) => key.toUpperCase(),
    validateKey: (key, existingKeys) => {
      if (!isValidEnvKey(key)) {
        return 'keys must match ^[A-Z_][A-Z0-9_]*$';
      }
      if (existingKeys.includes(key)) {
        return `key "${key}" already exists`;
      }
      return null;
    },
    maskValue: (key, value) => {
      if (isSecret(key, value)) {
        return { masked: true, display: maskValue(value) };
      }
      return { masked: false, display: value };
    },
  };

  return <KeyValueEditor config={config} initial={initialRecord} onSave={onSave} />;
}
