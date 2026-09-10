import { jsx, jsxs } from "react/jsx-runtime";
import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_KEYWORDS = /SECRET|KEY|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE/i;
const TERM_WIDTH = Math.max(process.stdout.columns ?? 80, 60);
const BOX_WIDTH = Math.min(TERM_WIDTH - 2, 80);
const KEY_COL = 30;
const VAL_COL = BOX_WIDTH - KEY_COL - 6;
function isSecret(key, value) {
  if (SECRET_KEYWORDS.test(key)) return true;
  if (value.length > 20 && !/\s/.test(value) && /[A-Za-z]/.test(value) && /[0-9]/.test(value)) {
    return true;
  }
  return false;
}
function maskValue(value) {
  if (value.length <= 4) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" + value.slice(-4);
}
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + "\u2026";
}
function buildRows(initial) {
  return initial.map(({ key, value }) => ({
    key,
    value,
    originalKey: key,
    originalValue: value,
    state: "unchanged"
  }));
}
function countChanges(rows) {
  let modified = 0, added = 0, deleted = 0;
  for (const r of rows) {
    if (r.state === "modified") modified++;
    else if (r.state === "new") added++;
    else if (r.state === "deleted") deleted++;
  }
  return { modified, added, deleted, total: modified + added + deleted };
}
function Header({
  appName,
  modified,
  added,
  deleted
}) {
  const total = modified + added + deleted;
  const parts = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (added > 0) parts.push(`${added} new`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  const summary = parts.join(" \xB7 ");
  const title = `dm env \xB7 ${appName}`;
  const right = summary || "";
  const gap = Math.max(0, BOX_WIDTH - title.length - right.length - 2);
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { bold: true, children: title }),
    /* @__PURE__ */ jsx(Text, { children: " ".repeat(gap) }),
    total > 0 && /* @__PURE__ */ jsx(Text, { color: "yellow", children: right })
  ] });
}
function Footer({ mode }) {
  const legend = mode === "list" ? "\u2191\u2193 move   enter edit   n new   d delete   u undo   s save   q quit" : "";
  return /* @__PURE__ */ jsx(Box, { marginTop: 0, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: legend }) });
}
function TableHeader() {
  const keyLabel = truncate("KEY", KEY_COL);
  const valLabel = truncate("VALUE", VAL_COL);
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "  " }),
    /* @__PURE__ */ jsx(Text, { bold: true, children: keyLabel }),
    /* @__PURE__ */ jsx(Text, { children: " " }),
    /* @__PURE__ */ jsx(Text, { bold: true, children: valLabel }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "   \u2502" })
  ] });
}
function renderEnvRow(rowKey, row, selected, isEditing, editDraft, setEditDraft, showReal) {
  return React.createElement(EnvRowWrapper, {
    key: rowKey,
    row,
    selected,
    isEditing,
    editDraft,
    setEditDraft,
    showReal
  });
}
function EnvEditor({ appName, initial, onSave }) {
  const { exit } = useApp();
  const [rows, setRows] = useState(() => buildRows(initial));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState("list");
  const [editDraft, setEditDraft] = useState("");
  const [newKeyDraft, setNewKeyDraft] = useState("");
  const [newValDraft, setNewValDraft] = useState("");
  const [keyError, setKeyError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const changes = countChanges(rows);
  const visibleRows = rows;
  const clampCursor = useCallback((idx, len) => {
    if (len === 0) return 0;
    return Math.max(0, Math.min(idx, len - 1));
  }, []);
  useInput((input, key) => {
    if (mode === "list") {
      if (key.upArrow) {
        setCursor((c) => clampCursor(c - 1, visibleRows.length));
      } else if (key.downArrow) {
        setCursor((c) => clampCursor(c + 1, visibleRows.length));
      } else if (key.return) {
        const row = visibleRows[cursor];
        if (!row || row.state === "deleted") return;
        setEditDraft(row.value);
        setMode("edit-value");
      } else if (input === "n") {
        setNewKeyDraft("");
        setNewValDraft("");
        setKeyError("");
        setMode("add-key");
      } else if (input === "d") {
        const row = visibleRows[cursor];
        if (!row) return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === "new") {
            next.splice(cursor, 1);
            setCursor((c) => clampCursor(c, next.length));
          } else if (r.state === "deleted") {
          } else {
            r.state = "deleted";
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === "u") {
        const row = visibleRows[cursor];
        if (!row) return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === "deleted") {
            r.state = r.originalValue !== void 0 && r.value !== r.originalValue ? "modified" : "unchanged";
            next[cursor] = r;
          } else if (r.state === "modified") {
            r.value = r.originalValue ?? r.value;
            r.state = "unchanged";
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === "s") {
        if (changes.total === 0) {
          exit();
          return;
        }
        setSavedCount(changes.total);
        setMode("confirm-save");
      } else if (input === "q" || key.escape) {
        if (changes.total === 0) {
          exit();
          return;
        }
        setMode("confirm-quit");
      }
      return;
    }
    if (mode === "edit-value") {
      if (key.return) {
        const row = visibleRows[cursor];
        if (!row) return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          r.value = editDraft;
          if (r.state === "new") {
          } else if (editDraft === r.originalValue) {
            r.state = "unchanged";
          } else {
            r.state = "modified";
          }
          next[cursor] = r;
          return next;
        });
        setMode("list");
      } else if (key.escape) {
        setMode("list");
      }
      return;
    }
    if (mode === "add-key") {
      if (key.return) {
        const k = newKeyDraft.trim().toUpperCase();
        if (!KEY_REGEX.test(k)) {
          setKeyError("keys must match ^[A-Z_][A-Z0-9_]*$");
          return;
        }
        if (rows.some((r) => r.key === k && r.state !== "deleted")) {
          setKeyError(`key "${k}" already exists`);
          return;
        }
        setNewKeyDraft(k);
        setNewValDraft("");
        setKeyError("");
        setMode("add-value");
      } else if (key.escape) {
        setMode("list");
      }
      return;
    }
    if (mode === "add-value") {
      if (key.return) {
        const newRow = {
          key: newKeyDraft,
          value: newValDraft,
          state: "new"
        };
        setRows((prev) => {
          const next = [...prev, newRow];
          setCursor(next.length - 1);
          return next;
        });
        setMode("list");
      } else if (key.escape) {
        setMode("list");
      }
      return;
    }
    if (mode === "confirm-save") {
      if (key.return || input === "y" || input === "Y") {
        setMode("saved");
      } else if (input === "n" || input === "N" || key.escape) {
        setMode("list");
      }
      return;
    }
    if (mode === "confirm-quit") {
      if (input === "y" || input === "Y") {
        exit();
      } else {
        setMode("list");
      }
      return;
    }
  });
  useEffect(() => {
    if (mode !== "saved") return;
    onSave(rows, savedCount).then(() => exit()).catch(() => exit());
  }, [mode]);
  if (mode === "confirm-save") {
    const pending = rows.filter((r) => r.state !== "unchanged");
    return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsxs(Text, { children: [
        "Save changes to ",
        /* @__PURE__ */ jsx(Text, { bold: true, children: appName }),
        "?"
      ] }),
      /* @__PURE__ */ jsx(Box, { flexDirection: "column", marginTop: 1, children: pending.map((r, i) => {
        const prefix = r.state === "new" ? "+" : r.state === "deleted" ? "-" : "*";
        const col = r.state === "new" ? "green" : r.state === "deleted" ? "red" : "yellow";
        return /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsxs(Text, { color: col, children: [
          " ",
          prefix,
          " ",
          r.key
        ] }) }, i);
      }) }),
      /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
        /* @__PURE__ */ jsx(Text, { children: "[Y] save " }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "[n] cancel, back to editor" })
      ] })
    ] });
  }
  if (mode === "confirm-quit") {
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: /* @__PURE__ */ jsxs(Text, { color: "yellow", children: [
      "Discard ",
      changes.total,
      " unsaved changes to ",
      /* @__PURE__ */ jsx(Text, { bold: true, children: appName }),
      "? [y/N]"
    ] }) });
  }
  if (mode === "saved") {
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: /* @__PURE__ */ jsxs(Text, { color: "green", children: [
      "\u2713 Saving ",
      savedCount,
      " changes to ",
      appName,
      "\u2026"
    ] }) });
  }
  const isEmpty = rows.length === 0 && mode !== "add-key" && mode !== "add-value";
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(
      Header,
      {
        appName,
        modified: changes.modified,
        added: changes.added,
        deleted: changes.deleted
      }
    ),
    /* @__PURE__ */ jsx(Text, { children: "\u250C" + "\u2500".repeat(BOX_WIDTH) + "\u2510" }),
    /* @__PURE__ */ jsx(TableHeader, {}),
    /* @__PURE__ */ jsx(Text, { children: "\u251C" + "\u2500".repeat(BOX_WIDTH) + "\u2524" }),
    isEmpty ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
        /* @__PURE__ */ jsxs(Text, { children: [
          " ",
          "No environment variables set for ",
          appName,
          ".",
          " ".repeat(Math.max(0, BOX_WIDTH - 40 - appName.length))
        ] }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
      ] }),
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
        /* @__PURE__ */ jsxs(Text, { children: [
          " Press n to add one.",
          " ".repeat(BOX_WIDTH - 20)
        ] }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
      ] })
    ] }) : visibleRows.map((row, i) => {
      const sel = i === cursor;
      const isEditing = sel && mode === "edit-value";
      const rowKey = `${row.key || "new"}-${i}`;
      return renderEnvRow(
        rowKey,
        row,
        sel,
        isEditing,
        editDraft,
        setEditDraft,
        isEditing
      );
    }),
    mode === "add-key" && /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
        /* @__PURE__ */ jsx(Text, { color: "green", children: "+ " }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            value: newKeyDraft,
            onChange: setNewKeyDraft,
            placeholder: "NEW_VAR_NAME"
          }
        ),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
      ] }),
      keyError ? /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
        /* @__PURE__ */ jsxs(Text, { color: "red", children: [
          " \u26A0 ",
          keyError
        ] }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
      ] }) : null
    ] }),
    mode === "add-value" && /* @__PURE__ */ jsxs(Box, { children: [
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
      /* @__PURE__ */ jsxs(Text, { color: "green", children: [
        "+ ",
        newKeyDraft.padEnd(KEY_COL - 2),
        " "
      ] }),
      /* @__PURE__ */ jsx(
        TextInput,
        {
          value: newValDraft,
          onChange: setNewValDraft,
          placeholder: ""
        }
      ),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
    ] }),
    /* @__PURE__ */ jsx(Text, { children: "\u2514" + "\u2500".repeat(BOX_WIDTH) + "\u2518" }),
    /* @__PURE__ */ jsx(Footer, { mode })
  ] });
}
function EnvRowWrapper({
  row,
  selected,
  isEditing,
  editDraft,
  setEditDraft,
  showReal
}) {
  const deleted = row.state === "deleted";
  const isNew = row.state === "new";
  const isMod = row.state === "modified";
  const marker = isNew ? "+" : isMod ? "*" : deleted ? "-" : " ";
  const keyColor = isNew ? "green" : void 0;
  const valColor = isMod ? "yellow" : isNew ? "green" : void 0;
  const displayKey = truncate(row.key, KEY_COL);
  const rawValue = row.value;
  const displayValue = !showReal && isSecret(row.key, row.value) && !isEditing ? maskValue(row.value) : rawValue;
  const truncatedVal = truncate(displayValue, VAL_COL);
  const prefix = selected ? "\u25B8" : " ";
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
    /* @__PURE__ */ jsxs(Text, { inverse: selected, children: [
      prefix,
      " "
    ] }),
    deleted ? /* @__PURE__ */ jsx(Text, { dimColor: true, strikethrough: true, children: displayKey }) : /* @__PURE__ */ jsx(Text, { color: keyColor, inverse: selected, children: displayKey }),
    /* @__PURE__ */ jsx(Text, { inverse: selected, children: " " }),
    isEditing ? /* @__PURE__ */ jsx(TextInput, { value: editDraft, onChange: setEditDraft }) : deleted ? /* @__PURE__ */ jsx(Text, { dimColor: true, strikethrough: true, children: truncatedVal.padEnd(VAL_COL) }) : /* @__PURE__ */ jsx(Text, { color: valColor, inverse: selected, children: truncatedVal.padEnd(VAL_COL) }),
    /* @__PURE__ */ jsxs(Text, { inverse: selected, children: [
      " ",
      marker,
      " "
    ] }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
  ] });
}
export {
  EnvEditor
};
