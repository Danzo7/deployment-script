import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RowState = 'unchanged' | 'modified' | 'new' | 'deleted';

export interface HeaderRow {
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
  target: string; // e.g. "example.com" or "example.com /api"
  initial: Record<string, string>;
  onSave: (rows: HeaderRow[], count: number) => Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TERM_WIDTH = Math.max(process.stdout.columns ?? 80, 60);
const BOX_WIDTH = Math.min(TERM_WIDTH - 2, 80);
const KEY_COL = 30;
const VAL_COL = BOX_WIDTH - KEY_COL - 6;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + '…';
}

function buildRows(initial: Record<string, string>): HeaderRow[] {
  return Object.entries(initial).map(([key, value]) => ({
    key,
    value,
    originalKey: key,
    originalValue: value,
    state: 'unchanged' as RowState,
  }));
}

function countChanges(rows: HeaderRow[]) {
  let modified = 0,
    added = 0,
    deleted = 0;
  for (const r of rows) {
    if (r.state === 'modified') modified++;
    else if (r.state === 'new') added++;
    else if (r.state === 'deleted') deleted++;
  }
  return { modified, added, deleted, total: modified + added + deleted };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header({
  target,
  modified,
  added,
  deleted,
}: {
  target: string;
  modified: number;
  added: number;
  deleted: number;
}) {
  const total = modified + added + deleted;
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (added > 0) parts.push(`${added} new`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  const summary = parts.join(' · ');
  const title = `dm headers · ${target}`;
  const gap = Math.max(0, BOX_WIDTH - title.length - summary.length - 2);
  return (
    <Box>
      <Text bold>{title}</Text>
      <Text>{' '.repeat(gap)}</Text>
      {total > 0 && <Text color="yellow">{summary}</Text>}
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
  return (
    <Box>
      <Text dimColor>{'│'}</Text>
      <Text dimColor>{'  '}</Text>
      <Text bold>{truncate('HEADER', KEY_COL)}</Text>
      <Text> </Text>
      <Text bold>{truncate('VALUE', VAL_COL)}</Text>
      <Text dimColor>{'   │'}</Text>
    </Box>
  );
}

function HeaderRowWrapper({
  row,
  selected,
  isEditing,
  editDraft,
  setEditDraft,
}: {
  row: HeaderRow;
  selected: boolean;
  isEditing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
}) {
  const deleted = row.state === 'deleted';
  const isNew = row.state === 'new';
  const isMod = row.state === 'modified';

  const marker = isNew ? '+' : isMod ? '*' : deleted ? '-' : ' ';
  const keyColor = isNew ? 'green' : undefined;
  const valColor = isMod ? 'yellow' : isNew ? 'green' : undefined;

  const displayKey = truncate(row.key, KEY_COL);
  const displayValue = truncate(row.value, VAL_COL);
  const prefix = selected ? '▸' : ' ';

  return (
    <Box>
      <Text dimColor>{'│'}</Text>
      <Text inverse={selected}>{prefix} </Text>
      {deleted ? (
        <Text dimColor strikethrough>
          {displayKey}
        </Text>
      ) : (
        <Text color={keyColor} inverse={selected}>
          {displayKey}
        </Text>
      )}
      <Text inverse={selected}> </Text>
      {isEditing ? (
        <TextInput value={editDraft} onChange={setEditDraft} />
      ) : deleted ? (
        <Text dimColor strikethrough>
          {displayValue.padEnd(VAL_COL)}
        </Text>
      ) : (
        <Text color={valColor} inverse={selected}>
          {displayValue.padEnd(VAL_COL)}
        </Text>
      )}
      <Text inverse={selected}> {marker} </Text>
      <Text dimColor>{'│'}</Text>
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HeaderEditor({ target, initial, onSave }: Props) {
  const { exit } = useApp();

  const [rows, setRows] = useState<HeaderRow[]>(() => buildRows(initial));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');

  const [editDraft, setEditDraft] = useState('');
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
        setCursor((c) => clampCursor(c - 1, rows.length));
      } else if (key.downArrow) {
        setCursor((c) => clampCursor(c + 1, rows.length));
      } else if (key.return) {
        const row = rows[cursor];
        if (!row || row.state === 'deleted') return;
        setEditDraft(row.value);
        setMode('edit-value');
      } else if (input === 'n') {
        setNewKeyDraft('');
        setNewValDraft('');
        setKeyError('');
        setMode('add-key');
      } else if (input === 'd') {
        const row = rows[cursor];
        if (!row || row.state === 'deleted') return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === 'new') {
            next.splice(cursor, 1);
            setCursor((c) => clampCursor(c, next.length));
          } else {
            r.state = 'deleted';
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === 'u') {
        const row = rows[cursor];
        if (!row) return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === 'deleted') {
            r.state = r.value !== r.originalValue ? 'modified' : 'unchanged';
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
        setMode('confirm-save');
      } else if (input === 'q' || key.escape) {
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
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          r.value = editDraft;
          if (r.state !== 'new') {
            r.state = editDraft === r.originalValue ? 'unchanged' : 'modified';
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
        const k = newKeyDraft.trim();
        if (!k) {
          setKeyError('Header name cannot be empty');
          return;
        }
        if (
          rows.some(
            (r) =>
              r.key.toLowerCase() === k.toLowerCase() && r.state !== 'deleted'
          )
        ) {
          setKeyError(`"${k}" already exists`);
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
        const newRow: HeaderRow = {
          key: newKeyDraft,
          value: newValDraft,
          state: 'new',
        };
        setRows((prev) => {
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
  });

  useEffect(() => {
    if (mode !== 'saved') return;
    onSave(rows, savedCount)
      .then(() => exit())
      .catch(() => exit());
  }, [mode]);

  // ── Confirm / saved screens ───────────────────────────────────────────────

  if (mode === 'confirm-save') {
    const pending = rows.filter((r) => r.state !== 'unchanged');
    return (
      <Box flexDirection="column">
        <Text>
          Save changes to <Text bold>{target}</Text>?
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {pending.map((r, i) => {
            const prefix =
              r.state === 'new' ? '+' : r.state === 'deleted' ? '-' : '*';
            const col =
              r.state === 'new'
                ? 'green'
                : r.state === 'deleted'
                  ? 'red'
                  : 'yellow';
            return (
              <Box key={i}>
                <Text color={col}>
                  {' '}
                  {prefix} {r.key}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text>[Y] save </Text>
          <Text dimColor>[n] cancel, back to editor</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'confirm-quit') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          Discard {changes.total} unsaved changes to <Text bold>{target}</Text>?
          [y/N]
        </Text>
      </Box>
    );
  }

  if (mode === 'saved') {
    return (
      <Box flexDirection="column">
        <Text color="green">
          ✓ Saving {savedCount} changes to {target}…
        </Text>
      </Box>
    );
  }

  // ── List / edit / add ─────────────────────────────────────────────────────

  const isEmpty =
    rows.length === 0 && mode !== 'add-key' && mode !== 'add-value';

  return (
    <Box flexDirection="column">
      <Header
        target={target}
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
            <Text>
              {' '}
              No headers set for {target}.
              {' '.repeat(Math.max(0, BOX_WIDTH - 18 - target.length))}
            </Text>
            <Text dimColor>{'│'}</Text>
          </Box>
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text> Press n to add one.{' '.repeat(BOX_WIDTH - 20)}</Text>
            <Text dimColor>{'│'}</Text>
          </Box>
        </Box>
      ) : (
        rows.map((row, i) =>
          React.createElement(HeaderRowWrapper, {
            key: `${row.key}-${i}`,
            row,
            selected: i === cursor,
            isEditing: i === cursor && mode === 'edit-value',
            editDraft,
            setEditDraft,
          })
        )
      )}

      {mode === 'add-key' && (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text color="green">+ </Text>
            <TextInput
              value={newKeyDraft}
              onChange={setNewKeyDraft}
              placeholder="X-My-Header"
            />
            <Text dimColor>{'│'}</Text>
          </Box>
          {keyError ? (
            <Box>
              <Text dimColor>{'│'}</Text>
              <Text color="red"> ⚠ {keyError}</Text>
              <Text dimColor>{'│'}</Text>
            </Box>
          ) : null}
        </Box>
      )}

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
