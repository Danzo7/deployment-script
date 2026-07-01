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
  | 'confirm-restart'
  | 'saved';

interface Props {
  appName: string;
  initial: EnvEntry[];
  isRunning: boolean;
  onSave: (rows: EditorRow[]) => Promise<void>;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const TERM_WIDTH = Math.max(process.stdout.columns ?? 80, 60);
const BOX_WIDTH = Math.min(TERM_WIDTH - 2, 80);
const KEY_COL = 30;
const VAL_COL = BOX_WIDTH - KEY_COL - 6;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SECRET_KEYWORDS = /SECRET|KEY|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE/i;
const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

function isSecret(key: string, value: string): boolean {
  if (SECRET_KEYWORDS.test(key)) return true;
  return value.length > 20 && !/\s/.test(value) && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
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

function Header(props: { appName: string; modified: number; added: number; deleted: number }) {
  const parts: string[] = [];
  if (props.modified > 0) parts.push(`${props.modified} modified`);
  if (props.added > 0) parts.push(`${props.added} new`);
  if (props.deleted > 0) parts.push(`${props.deleted} deleted`);
  const summary = parts.join(' · ');
  const title = `dm env · ${props.appName}`;
  const gap = Math.max(0, BOX_WIDTH - title.length - summary.length - 2);
  return (
    <Box>
      <Text bold>{title}</Text>
      <Text>{' '.repeat(gap)}</Text>
      {summary ? <Text color="yellow">{summary}</Text> : null}
    </Box>
  );
}

function TableHeader() {
  return (
    <Box>
      <Text dimColor>{'|'}</Text>
      <Text dimColor>{'  '}</Text>
      <Text bold>{truncate('KEY', KEY_COL)}</Text>
      <Text>{' '}</Text>
      <Text bold>{truncate('VALUE', VAL_COL)}</Text>
      <Text dimColor>{'   |'}</Text>
    </Box>
  );
}

interface RowWrapperProps {
  row: EditorRow;
  selected: boolean;
  isEditing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
  showReal: boolean;
}

function EnvRowWrapper(props: RowWrapperProps) {
  const { row, selected, isEditing, editDraft, setEditDraft, showReal } = props;
  const deleted = row.state === 'deleted';
  const isNew = row.state === 'new';
  const isMod = row.state === 'modified';

  const marker = isNew ? '+' : isMod ? '*' : deleted ? '-' : ' ';
  const keyColor: string | undefined = isNew ? 'green' : undefined;
  const valColor: string | undefined = isMod ? 'yellow' : isNew ? 'green' : undefined;

  const displayKey = truncate(row.key, KEY_COL);
  const displayValue = (!showReal && isSecret(row.key, row.value) && !isEditing)
    ? maskValue(row.value)
    : row.value;
  const truncatedVal = truncate(displayValue, VAL_COL);
  const prefix = selected ? String.fromCharCode(9658) + ' ' : '  ';

  return (
    <Box>
      <Text dimColor>{'|'}</Text>
      <Text inverse={selected}>{prefix}</Text>
      {deleted
        ? <Text dimColor strikethrough>{displayKey}</Text>
        : <Text color={keyColor} inverse={selected}>{displayKey}</Text>
      }
      <Text inverse={selected}>{' '}</Text>
      {isEditing
        ? <TextInput value={editDraft} onChange={setEditDraft} />
        : deleted
          ? <Text dimColor strikethrough>{truncatedVal.padEnd(VAL_COL)}</Text>
          : <Text color={valColor} inverse={selected}>{truncatedVal.padEnd(VAL_COL)}</Text>
      }
      <Text inverse={selected}> {marker} </Text>
      <Text dimColor>{'|'}</Text>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EnvEditor(props: Props) {
  const { appName, initial, isRunning, onSave } = props;
  const { exit } = useApp();

  const [rows, setRows] = useState<EditorRow[]>(() => buildRows(initial));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [editDraft, setEditDraft] = useState('');
  const [showReal, setShowReal] = useState(false);
  const [newKeyDraft, setNewKeyDraft] = useState('');
  const [newValDraft, setNewValDraft] = useState('');
  const [keyError, setKeyError] = useState('');
  const [savedCount, setSavedCount] = useState(0);

  const changes = countChanges(rows);

  const clampCursor = useCallback((idx: number, len: number) => {
    if (len === 0) return 0;
    return Math.max(0, Math.min(idx, len - 1));
  }, []);

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.upArrow) {
        setCursor(c => clampCursor(c - 1, rows.length));
      } else if (key.downArrow) {
        setCursor(c => clampCursor(c + 1, rows.length));
      } else if (key.return) {
        const row = rows[cursor];
        if (!row || row.state === 'deleted') return;
        setEditDraft(row.value);
        setShowReal(true);
        setMode('edit-value');
      } else if (input === 'n') {
        setNewKeyDraft('');
        setNewValDraft('');
        setKeyError('');
        setMode('add-key');
      } else if (input === 'd') {
        const row = rows[cursor];
        if (!row) return;
        setRows(prev => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === 'new') {
            next.splice(cursor, 1);
            setCursor(c => clampCursor(c, next.length));
          } else if (r.state !== 'deleted') {
            r.state = 'deleted';
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === 'u') {
        setRows(prev => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === 'deleted') {
            r.state = (r.originalValue !== undefined && r.value !== r.originalValue)
              ? 'modified' : 'unchanged';
            next[cursor] = r;
          } else if (r.state === 'modified') {
            r.value = r.originalValue ?? r.value;
            r.state = 'unchanged';
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === 's') {
        if (changes.total === 0) { exit(); return; }
        setMode('confirm-save');
      } else if (input === 'q' || key.escape) {
        if (changes.total === 0) { exit(); return; }
        setMode('confirm-quit');
      }
      return;
    }

    if (mode === 'edit-value') {
      if (key.return) {
        setRows(prev => {
          const next = [...prev];
          const r = { ...next[cursor] };
          r.value = editDraft;
          r.state = editDraft === r.originalValue ? 'unchanged' : 'modified';
          next[cursor] = r;
          return next;
        });
        setShowReal(false);
        setMode('list');
      } else if (key.escape) {
        setShowReal(false);
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
        if (rows.some(r => r.key === k && r.state !== 'deleted')) {
          setKeyError(`key "${k}" already exists`);
          return;
        }
        setNewKeyDraft(k);
        setKeyError('');
        setMode('add-value');
      } else if (key.escape) {
        setMode('list');
      }
      return;
    }

    if (mode === 'add-value') {
      if (key.return) {
        const newRow: EditorRow = { key: newKeyDraft, value: newValDraft, state: 'new' };
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
        setMode('saved');
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

    if (mode === 'confirm-restart') {
      if (key.return || input === 'y' || input === 'Y') {
        process.env['_DM_RESTART_AFTER_SAVE'] = '1';
        exit();
      } else {
        exit();
      }
    }
  });

  // Trigger save when mode transitions to 'saved'
  useEffect(() => {
    if (mode !== 'saved') return;
    const count = changes.total;
    setSavedCount(count);
    onSave(rows)
      .then(() => {
        if (isRunning) setMode('confirm-restart');
        else exit();
      })
      .catch(() => exit());
  }, [mode]); // intentional narrow dep — only fires on mode change to 'saved'

  // ── Render ────────────────────────────────────────────────────────────────

  if (mode === 'confirm-save') {
    const pending = rows.filter(r => r.state !== 'unchanged');
    return (
      <Box flexDirection="column">
        <Text>Save changes to <Text bold>{appName}</Text>?</Text>
        <Box flexDirection="column" marginTop={1}>
          {pending.map((r, i) => {
            const pfx = r.state === 'new' ? '+' : r.state === 'deleted' ? '-' : '*';
            const col: string = r.state === 'new' ? 'green' : r.state === 'deleted' ? 'red' : 'yellow';
            return (
              <Box key={`pending-${i}`}>
                <Text color={col}> {pfx} {r.key}</Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text>[Y] save   </Text>
          <Text dimColor>[n] cancel, back to editor</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'confirm-quit') {
    return (
      <Box>
        <Text color="yellow">
          Discard {changes.total} unsaved changes to <Text bold>{appName}</Text>? [y/N]
        </Text>
      </Box>
    );
  }

  if (mode === 'saved') {
    return (
      <Box>
        <Text color="green">Saving changes to {appName}...</Text>
      </Box>
    );
  }

  if (mode === 'confirm-restart') {
    return (
      <Box flexDirection="column">
        <Text color="green">Saved {savedCount} changes to {appName}</Text>
        <Text>Restart <Text bold>{appName}</Text> to apply changes now? [Y/n]</Text>
      </Box>
    );
  }

  const isEmpty = rows.length === 0 && mode !== 'add-key' && mode !== 'add-value';
  const topBorder = '+' + '-'.repeat(BOX_WIDTH) + '+';
  const midBorder = '+' + '-'.repeat(BOX_WIDTH) + '+';
  const botBorder = '+' + '-'.repeat(BOX_WIDTH) + '+';

  return (
    <Box flexDirection="column">
      <Header
        appName={appName}
        modified={changes.modified}
        added={changes.added}
        deleted={changes.deleted}
      />
      <Text>{topBorder}</Text>
      <TableHeader />
      <Text>{midBorder}</Text>

      {isEmpty ? (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'|'}</Text>
            <Text>{'  No environment variables set for '}{appName}{'.'}{' '.repeat(Math.max(0, BOX_WIDTH - 38 - appName.length))}</Text>
            <Text dimColor>{'|'}</Text>
          </Box>
          <Box>
            <Text dimColor>{'|'}</Text>
            <Text>{'  Press n to add one.'}{' '.repeat(Math.max(0, BOX_WIDTH - 21))}</Text>
            <Text dimColor>{'|'}</Text>
          </Box>
        </Box>
      ) : (
        rows.map((row, i) => {
          const sel = i === cursor;
          const isEd = sel && mode === 'edit-value';
          return (
            <Box key={`row-${i}`}>
              <EnvRowWrapper
                row={row}
                selected={sel}
                isEditing={isEd}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                showReal={showReal}
              />
            </Box>
          );
        })
      )}

      {mode === 'add-key' && (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'|'}</Text>
            <Text color="green">{'+ '}</Text>
            <TextInput value={newKeyDraft} onChange={setNewKeyDraft} placeholder="NEW_VAR_NAME" />
            <Text dimColor>{'|'}</Text>
          </Box>
          {keyError ? (
            <Box>
              <Text dimColor>{'|'}</Text>
              <Text color="red">{'  '}{'\u26A0'} {keyError}</Text>
              <Text dimColor>{'|'}</Text>
            </Box>
          ) : null}
        </Box>
      )}

      {mode === 'add-value' && (
        <Box>
          <Text dimColor>{'|'}</Text>
          <Text color="green">{'+ '}{newKeyDraft.padEnd(KEY_COL - 2)}{' '}</Text>
          <TextInput value={newValDraft} onChange={setNewValDraft} placeholder="" />
          <Text dimColor>{'|'}</Text>
        </Box>
      )}

      <Text>{botBorder}</Text>
      {mode === 'list' && (
        <Text dimColor>
          {'\u2191\u2193 move   enter edit   n new   d delete   u undo   s save   q quit'}
        </Text>
      )}
    </Box>
  );
}
