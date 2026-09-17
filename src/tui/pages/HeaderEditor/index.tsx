import React from 'react';
import {
  KeyValueEditor,
  type EditorRow,
  type RowState,
  type KeyValueEditorConfig,
} from '../../components/editors/KeyValueEditor.js';

// Re-export types
export type { RowState, EditorRow as HeaderRow };

interface HeaderEditorProps {
  target: string; // e.g. "example.com" or "example.com /api"
  initial: Record<string, string>;
  onCancel: () => void;
  onSave: (rows: EditorRow[], count: number) => Promise<unknown>;
}

export function HeaderEditor({
  target,
  initial,
  onSave,
  onCancel
}: HeaderEditorProps): React.ReactElement {
  const config: KeyValueEditorConfig = {
    targetName: target,
    editorLabel: 'dm headers',
    keyLabel: 'HEADER',
    valueLabel: 'VALUE',
    keyPlaceholder: 'X-My-Header',
    validateKey: (key, existingKeys) => {
      if (!key) {
        return 'Header name cannot be empty';
      }
      // Case-insensitive duplicate check for HTTP headers
      if (
        existingKeys.some(
          (existing) => existing.toLowerCase() === key.toLowerCase()
        )
      ) {
        return `"${key}" already exists`;
      }
      return null;
    },
    // No transformation for headers (keep as-is)
    // No masking for headers
  };

  return <KeyValueEditor onCancel={onCancel} config={config} initial={initial} onSave={onSave} />;
}
