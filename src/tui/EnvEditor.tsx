import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { EnvEntry } from '../utils/env-file-parser.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RowState = 'unchanged' | 'modified' | 'new' | 'deleted';

export interface EditorRow {
  key: string;
  value: string;
  originalKey?: string;
  originalValue?: string;
  state: RowState;
}

type Mode =
  | 'list'
  | 'edit-value'
  | 'add-key'
  | 'add-value'
  | 'confirm-save'
  | 'confirm-quit'
  | 'saved';

interface Props {
  appName: string;
  initial: EnvEntry[];
  onSave: (rows: EditorRow[], count: number) => Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_KEYWORDS = /SECRET|KEY|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE/i;
const TERM_WIDTH = Math.max(process.stdout.columns ?? 80, 60);
const BOX_WIDTH = Math.min(TERM_WIDTH - 2, 80);
const KEY_COL = 30;
const VAL_COL = BOX_WIDTH - KEY_COL - 6;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSecret(key: string, value: string): boolean {
  if (SECRET_KEYWORDS.test(key)) return true;
  // high-entropy heuristic: long string, mostly non-space printable chars
  if (value.length > 20 && !/\s/.test(value) && /[A-Za-z]/.test(value) && /[0-9]/.test(value)) {
    return true;
  }
  return false;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '••••••••';
  return '••••••••' + value.slice(-4);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + '…';
}

function buildRows(initial: EnvEntry[]): EditorRow[] {
  return initial.map(({ key, value }) => ({
    key,
    value,
    originalKey: key,
    originalValue: value,
    state: 'unchanged' as RowState,
  }));
}

function countChanges(rows: EditorRow[]) {
  let modified = 0, added = 0, deleted = 0;
  for (const r of rows) {
    if (r.state === 'modified') modified++;
    else if (r.state === 'new') added++;
    else if (r.state === 'deleted') deleted++;
  }
  return { modified, added, deleted, total: modified + added + deleted };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header({ appName, modified, added, deleted }: {
  appName: string; modified: number; added: number; deleted: number;
}) {
  const total = modified + added + deleted;
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (added > 0) parts.push(`${added} new`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  const summary = parts.join(' · ');

  const title = `dm env · ${appName}`;
  const right = summary || '';
  const gap = Math.max(0, BOX_WIDTH - title.length - right.length - 2);

  return (
    <Box>
      <Text bold>{title}</Text>
      <Text>{' '.repeat(gap)}</Text>
      {total > 0 && <Text color="yellow">{right}</Text>}
    </Box>
  );
}

function Footer({ mode }: { mode: Mode }) {
  const legend =
    mode === 'list'
      ? '↑↓ move   enter edit   n new   d delete   u undo   s save   q quit'
      : '';
  return (
    <Box marginTop={0}>
      <Text dimColor>{legend}</Text>
    </Box>
  );
}

function TableHeader() {
  const keyLabel = truncate('KEY', KEY_COL);
  const valLabel = truncate('VALUE', VAL_COL);
  return (
    <Box>
      <Text dimColor>{'│'}</Text>
      <Text dimColor>{'  '}</Text>
      <Text bold>{keyLabel}</Text>
      <Text>{' '}</Text>
      <Text bold>{valLabel}</Text>
      <Text dimColor>{'   │'}</Text>
    </Box>
  );
}

// Helper to render a row without using a component (avoids key prop type issue)
function renderEnvRow(
  rowKey: string,
  row: EditorRow,
  selected: boolean,
  isEditing: boolean,
  editDraft: string,
  setEditDraft: (v: string) => void,
  showReal: boolean,
): React.ReactElement {
  return React.createElement(EnvRowWrapper, {
    key: rowKey,
    row,
    selected,
    isEditing,
    editDraft,
    setEditDraft,
    showReal,
  });
}

export function EnvEditor({ appName, initial, onSave }: Props) {
  const { exit } = useApp();

  const [rows, setRows] = useState<EditorRow[]>(() => buildRows(initial));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');

  // edit-value state
  const [editDraft, setEditDraft] = useState('');
  // add-key / add-value state
  const [newKeyDraft, setNewKeyDraft] = useState('');
  const [newValDraft, setNewValDraft] = useState('');
  const [keyError, setKeyError] = useState('');

  // saved message
  const [savedCount, setSavedCount] = useState(0);

  const changes = countChanges(rows);

  // Visible rows: deleted ones stay in list
  const visibleRows = rows;

  const clampCursor = useCallback((idx: number, len: number) => {
    if (len === 0) return 0;
    return Math.max(0, Math.min(idx, len - 1));
  }, []);

  // ── Input handler ─────────────────────────────────────────────────────────

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.upArrow) {
        setCursor(c => clampCursor(c - 1, visibleRows.length));
      } else if (key.downArrow) {
        setCursor(c => clampCursor(c + 1, visibleRows.length));
      } else if (key.return) {
        // enter edit mode for selected row
        const row = visibleRows[cursor];
        if (!row || row.state === 'deleted') return;
        setEditDraft(row.value);
        setMode('edit-value');
      } else if (input === 'n') {
        setNewKeyDraft('');
        setNewValDraft('');
        setKeyError('');
        setMode('add-key');
      } else if (input === 'd') {
        const row = visibleRows[cursor];
        if (!row) return;
        setRows(prev => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === 'new') {
            // newly added row — just remove it
            next.splice(cursor, 1);
            setCursor(c => clampCursor(c, next.length));
          } else if (r.state === 'deleted') {
            // undo delete on d-again? No — u is undo. d on deleted is no-op.
          } else {
            r.state = 'deleted';
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === 'u') {
        const row = visibleRows[cursor];
        if (!row) return;
        setRows(prev => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === 'deleted') {
            r.state = r.originalValue !== undefined && r.value !== r.originalValue
              ? 'modified'
              : 'unchanged';
            next[cursor] = r;
          } else if (r.state === 'modified') {
            r.value = r.originalValue ?? r.value;
            r.state = 'unchanged';
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === 's') {
        if (changes.total === 0) {
          exit();
          return;
        }
        setSavedCount(changes.total);
        setMode('confirm-save');      } else if (input === 'q' || key.escape) {
        if (changes.total === 0) {
          exit();
          return;
        }
        setMode('confirm-quit');
      }
      return;
    }

    if (mode === 'edit-value') {
      if (key.return) {
        const row = visibleRows[cursor];
        if (!row) return;
        setRows(prev => {
          const next = [...prev];
          const r = { ...next[cursor] };
          r.value = editDraft;
          if (r.state === 'new') {
            // keep as 'new' — editing a newly added row doesn't change its state
          } else if (editDraft === r.originalValue) {
            r.state = 'unchanged';
          } else {
            r.state = 'modified';
          }
          next[cursor] = r;
          return next;
        });
        setMode('list');
      } else if (key.escape) {
        setMode('list');
      }
      return;
    }

    if (mode === 'add-key') {
      if (key.return) {
        const k = newKeyDraft.trim().toUpperCase();
        if (!KEY_REGEX.test(k)) {
          setKeyError('keys must match ^[A-Z_][A-Z0-9_]*$');
          return;
        }
        // check duplicate
        if (rows.some(r => r.key === k && r.state !== 'deleted')) {
          setKeyError(`key "${k}" already exists`);
          return;
        }
        setNewKeyDraft(k);
        setNewValDraft('');
        setKeyError('');
        setMode('add-value');
      } else if (key.escape) {
        setMode('list');
      }
      return;
    }

    if (mode === 'add-value') {
      if (key.return) {
        const newRow: EditorRow = {
          key: newKeyDraft,
          value: newValDraft,
          state: 'new',
        };
        setRows(prev => {
          const next = [...prev, newRow];
          setCursor(next.length - 1);
          return next;
        });
        setMode('list');
      } else if (key.escape) {
        setMode('list');
      }
      return;
    }

    if (mode === 'confirm-save') {
      if (key.return || input === 'y' || input === 'Y') {
        setMode('saved'); // triggers save effect
      } else if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
      }
      return;
    }

    if (mode === 'confirm-quit') {
      if (input === 'y' || input === 'Y') {
        exit();
      } else {
        setMode('list');
      }
      return;
    }
  });

  useEffect(() => {
    if (mode !== 'saved') return;
    onSave(rows, savedCount).then(() => exit()).catch(() => exit());
  }, [mode]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (mode === 'confirm-save') {
    const pending = rows.filter(r => r.state !== 'unchanged');
    return (
      <Box flexDirection="column">
        <Text>Save changes to <Text bold>{appName}</Text>?</Text>
        <Box flexDirection="column" marginTop={1}>
          {pending.map((r, i) => {
            const prefix = r.state === 'new' ? '+' : r.state === 'deleted' ? '-' : '*';
            const col = r.state === 'new' ? 'green' : r.state === 'deleted' ? 'red' : 'yellow';
            return (
              <Box key={i}>
                <Text color={col}> {prefix} {r.key}</Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text>[Y] save   </Text><Text dimColor>[n] cancel, back to editor</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'confirm-quit') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Discard {changes.total} unsaved changes to <Text bold>{appName}</Text>? [y/N]</Text>
      </Box>
    );
  }

  if (mode === 'saved') {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Saving {savedCount} changes to {appName}…</Text>
      </Box>
    );
  }

  // list / edit / add modes
  const isEmpty = rows.length === 0 && mode !== 'add-key' && mode !== 'add-value';

  return (
    <Box flexDirection="column">
      <Header
        appName={appName}
        modified={changes.modified}
        added={changes.added}
        deleted={changes.deleted}
      />
      <Text>{'┌' + '─'.repeat(BOX_WIDTH) + '┐'}</Text>
      <TableHeader />
      <Text>{'├' + '─'.repeat(BOX_WIDTH) + '┤'}</Text>

      {isEmpty ? (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text>  No environment variables set for {appName}.{' '.repeat(Math.max(0, BOX_WIDTH - 40 - appName.length))}</Text>
            <Text dimColor>{'│'}</Text>
          </Box>
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text>  Press n to add one.{' '.repeat(BOX_WIDTH - 20)}</Text>
            <Text dimColor>{'│'}</Text>
          </Box>
        </Box>
      ) : (
        visibleRows.map((row, i) => {
          const sel = i === cursor;
          const isEditing = sel && mode === 'edit-value';
          const rowKey = `${row.key || 'new'}-${i}`;
          return renderEnvRow(rowKey, row, sel, isEditing, editDraft, setEditDraft, isEditing);
        })
      )}

      {/* Add-key inline row */}
      {mode === 'add-key' && (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text color="green">+ </Text>
            <TextInput
              value={newKeyDraft}
              onChange={setNewKeyDraft}
              placeholder="NEW_VAR_NAME"
            />
            <Text dimColor>{'│'}</Text>
          </Box>
          {keyError ? (
            <Box>
              <Text dimColor>{'│'}</Text>
              <Text color="red">  ⚠ {keyError}</Text>
              <Text dimColor>{'│'}</Text>
            </Box>
          ) : null}
        </Box>
      )}

      {/* Add-value inline row */}
      {mode === 'add-value' && (
        <Box>
          <Text dimColor>{'│'}</Text>
          <Text color="green">+ {newKeyDraft.padEnd(KEY_COL - 2)} </Text>
          <TextInput
            value={newValDraft}
            onChange={setNewValDraft}
            placeholder=""
          />
          <Text dimColor>{'│'}</Text>
        </Box>
      )}

      <Text>{'└' + '─'.repeat(BOX_WIDTH) + '┘'}</Text>
      <Footer mode={mode} />
    </Box>
  );
}

// Wrapper to handle edit input separately so we can pass onChange properly
function EnvRowWrapper({
  row,
  selected,
  isEditing,
  editDraft,
  setEditDraft,
  showReal,
}: {
  row: EditorRow;
  selected: boolean;
  isEditing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
  showReal: boolean;
}) {
  const deleted = row.state === 'deleted';
  const isNew = row.state === 'new';
  const isMod = row.state === 'modified';

  const marker = isNew ? '+' : isMod ? '*' : deleted ? '-' : ' ';
  const keyColor = isNew ? 'green' : undefined;
  const valColor = isMod ? 'yellow' : isNew ? 'green' : undefined;

  const displayKey = truncate(row.key, KEY_COL);
  const rawValue = row.value;
  const displayValue = (!showReal && isSecret(row.key, row.value) && !isEditing)
    ? maskValue(row.value)
    : rawValue;
  const truncatedVal = truncate(displayValue, VAL_COL);

  const prefix = selected ? '▸' : ' ';

  return (
    <Box>
      <Text dimColor>{'│'}</Text>
      <Text inverse={selected}>{prefix} </Text>
      {deleted ? (
        <Text dimColor strikethrough>{displayKey}</Text>
      ) : (
        <Text color={keyColor} inverse={selected}>{displayKey}</Text>
      )}
      <Text inverse={selected}>{' '}</Text>
      {isEditing ? (
        <TextInput value={editDraft} onChange={setEditDraft} />
      ) : deleted ? (
        <Text dimColor strikethrough>{truncatedVal.padEnd(VAL_COL)}</Text>
      ) : (
        <Text color={valColor} inverse={selected}>{truncatedVal.padEnd(VAL_COL)}</Text>
      )}
      <Text inverse={selected}> {marker} </Text>
      <Text dimColor>{'│'}</Text>
    </Box>
  );
}
