/** Env Editor types */

import { EnvEntry } from '../../../utils/env-file-parser.js';

export type RowState = 'unchanged' | 'modified' | 'new' | 'deleted';

export interface EditorRow {
  key: string;
  value: string;
  originalKey?: string;
  originalValue?: string;
  state: RowState;
}

export type Mode =
  | 'list'
  | 'edit-value'
  | 'add-key'
  | 'add-value'
  | 'confirm-save'
  | 'confirm-quit'
  | 'saved';

export interface EnvEditorProps {
  appName: string;
  initial: EnvEntry[];
  onSave: (rows: EditorRow[], count: number) => Promise<void>;
}
