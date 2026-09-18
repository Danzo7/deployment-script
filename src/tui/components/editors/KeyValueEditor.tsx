import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ControlledTextInput as TextInput } from '../ControlledTextInput.js';
import { TABLE_BOX_WIDTH, TABLE_KEY_COL, TABLE_VAL_COL } from '../../utils/constants.js';
import { countChanges } from '../../utils/editor-helpers.js';
import { useCursor } from '../../hooks/useCursor.js';
import { VirtualizedList } from '../VirtualizedList.js';

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

export interface KeyValueEditorConfig {
  /** Display name (e.g., "app-name" or "example.com") */
  targetName: string;
  /** Label for the editor (e.g., "dm env" or "dm headers") */
  editorLabel: string;
  /** Label for key column (e.g., "KEY" or "HEADER") */
  keyLabel: string;
  /** Label for value column (e.g., "VALUE" or "VALUE") */
  valueLabel: string;
  /** Placeholder for new key input (e.g., "NEW_VAR_NAME" or "X-My-Header") */
  keyPlaceholder: string;
  /** Validate key function - returns error message or null if valid */
  validateKey?: (key: string, existingKeys: string[]) => string | null;
  /** Transform key before saving (e.g., uppercase for env vars) */
  transformKey?: (key: string) => string;
  /** Mask sensitive values in display */
  maskValue?: (key: string, value: string) => { masked: boolean; display: string };
}

interface KeyValueEditorProps {
  config: KeyValueEditorConfig;
  initial: Record<string, string>;
  onCancel(result?: any): void;
  onSave: (rows: EditorRow[], count: number) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOX_WIDTH = TABLE_BOX_WIDTH;
const KEY_COL = TABLE_KEY_COL;
const VAL_COL = TABLE_VAL_COL(BOX_WIDTH, KEY_COL);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + '…';
}

function buildRows(initial: Record<string, string>): EditorRow[] {
  return Object.entries(initial).map(([key, value]) => ({
    key,
    value,
    originalKey: key,
    originalValue: value,
    state: 'unchanged' as RowState,
  }));
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header({
  config,
  modified,
  added,
  deleted,
}: {
  config: KeyValueEditorConfig;
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
  const title = `${config.editorLabel} · ${config.targetName}`;
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

function TableHeader({ config }: { config: KeyValueEditorConfig }) {
  return (
    <Box>
      <Text dimColor>{'│  '}</Text>
      <Text bold>{truncate(config.keyLabel, KEY_COL)}</Text>
      <Text> </Text>
      <Text bold>{truncate(config.valueLabel, VAL_COL)}</Text>
      <Text dimColor>{'   │'}</Text>
    </Box>
  );
}

function EditorRowComponent({
  row,
  selected,
  isEditing,
  editDraft,
  setEditDraft,
  config,
}: {
  row: EditorRow;
  selected: boolean;
  isEditing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
  config: KeyValueEditorConfig;
}) {
  const deleted = row.state === 'deleted';
  const isNew = row.state === 'new';
  const isMod = row.state === 'modified';

  const marker = isNew ? '+' : isMod ? '*' : deleted ? '-' : ' ';
  const keyColor = isNew ? 'green' : undefined;
  const valColor = isMod ? 'yellow' : isNew ? 'green' : undefined;

  const displayKey = truncate(row.key, KEY_COL);
  
  // Check if value should be masked
  let displayValue = row.value;
  if (!isEditing && config.maskValue) {
    const maskResult = config.maskValue(row.key, row.value);
    if (maskResult.masked) {
      displayValue = maskResult.display;
    }
  }
  const truncatedVal = truncate(displayValue, VAL_COL);

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
          {truncatedVal.padEnd(VAL_COL)}
        </Text>
      ) : (
        <Text color={valColor} inverse={selected}>
          {truncatedVal.padEnd(VAL_COL)}
        </Text>
      )}
      <Text inverse={selected}> {marker} </Text>
      <Text dimColor>{'│'}</Text>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function KeyValueEditor({
  config,
  initial,
  onSave,
  onCancel
}: KeyValueEditorProps): React.ReactElement {

  const [rows, setRows] = useState<EditorRow[]>(() => buildRows(initial));
  const { cursor, setCursor, clamp } = useCursor(0);
  const [mode, setMode] = useState<Mode>('list');

  const [editDraft, setEditDraft] = useState('');
  const [newKeyDraft, setNewKeyDraft] = useState('');
  const [newValDraft, setNewValDraft] = useState('');
  const [keyError, setKeyError] = useState('');
  const [savedCount, setSavedCount] = useState(0);

  const changes = countChanges(rows);

  const clampCursor = useCallback(
    (idx: number, len: number) => clamp(idx, len),
    [clamp]
  );

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
          onCancel();
          return;
        }
        setSavedCount(changes.total);
        setMode('confirm-save');
      } else if (input === 'q' || key.escape) {
        if (changes.total === 0) {
          onCancel();
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
        const transformedKey = config.transformKey
          ? config.transformKey(newKeyDraft.trim())
          : newKeyDraft.trim();

        if (!transformedKey) {
          setKeyError('Key cannot be empty');
          return;
        }

        // Validate key
        if (config.validateKey) {
          const existingKeys = rows
            .filter((r) => r.state !== 'deleted')
            .map((r) => r.key);
          const error = config.validateKey(transformedKey, existingKeys);
          if (error) {
            setKeyError(error);
            return;
          }
        }

        setNewKeyDraft(transformedKey);
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
        onCancel();
      } else {
        setMode('list');
      }
      return;
    }
  });

  useEffect(() => {
    if (mode !== 'saved') return;
    onSave(rows, savedCount)
  }, [mode, rows, savedCount, onSave]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (mode === 'confirm-save') {
    const pending = rows.filter((r) => r.state !== 'unchanged');
    return (
      <Box flexDirection="column">
        <Text>
          Save changes to <Text bold>{config.targetName}</Text>?
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
          Discard {changes.total} unsaved changes to{' '}
          <Text bold>{config.targetName}</Text>? [y/N]
        </Text>
      </Box>
    );
  }

  if (mode === 'saved') {
    return (
      <Box flexDirection="column">
        <Text color="green">
          ✓ Saving {savedCount} changes to {config.targetName}…
        </Text>
      </Box>
    );
  }

  // list / edit / add modes
  const isEmpty =
    rows.length === 0 && mode !== 'add-key' && mode !== 'add-value';

  return (
    <Box flexDirection="column">
      <Header
        config={config}
        modified={changes.modified}
        added={changes.added}
        deleted={changes.deleted}
      />
      <Text>{'┌' + '─'.repeat(BOX_WIDTH) + '┐'}</Text>
      <TableHeader config={config} />
      <Text>{'├' + '─'.repeat(BOX_WIDTH) + '┤'}</Text>

      {isEmpty ? (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text>
              {' '}
              No {config.keyLabel.toLowerCase()}s set for {config.targetName}.
              {' '.repeat(
                Math.max(
                  0,
                  BOX_WIDTH -
                    30 -
                    config.keyLabel.length -
                    config.targetName.length
                )
              )}
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
        <VirtualizedList
          items={rows}
          maxVisible={20}
          renderItem={(row, i) =>
            React.createElement(EditorRowComponent, {
              key: `${row.key}-${i}`,
              row,
              selected: i === cursor,
              isEditing: i === cursor && mode === 'edit-value',
              editDraft,
              setEditDraft,
              config,
            })
          }
        />
      )}

      {mode === 'add-key' && (
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{'│'}</Text>
            <Text color="green">+ </Text>
            <TextInput
              value={newKeyDraft}
              onChange={setNewKeyDraft}
              placeholder={config.keyPlaceholder}
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
