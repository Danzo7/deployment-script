/** Header Editor types */

export type RowState = 'unchanged' | 'modified' | 'new' | 'deleted';

export interface HeaderRow {
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

export interface HeaderEditorProps {
  target: string; // e.g. "example.com" or "example.com /api"
  initial: Record<string, string>;
  onSave: (rows: HeaderRow[], count: number) => Promise<void>;
}
