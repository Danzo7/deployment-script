import { jsx, jsxs } from "react/jsx-runtime";
import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
const TERM_WIDTH = Math.max(process.stdout.columns ?? 80, 60);
const BOX_WIDTH = Math.min(TERM_WIDTH - 2, 80);
const KEY_COL = 30;
const VAL_COL = BOX_WIDTH - KEY_COL - 6;
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + "\u2026";
}
function buildRows(initial) {
  return Object.entries(initial).map(([key, value]) => ({
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
  target,
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
  const title = `dm headers \xB7 ${target}`;
  const gap = Math.max(0, BOX_WIDTH - title.length - summary.length - 2);
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { bold: true, children: title }),
    /* @__PURE__ */ jsx(Text, { children: " ".repeat(gap) }),
    total > 0 && /* @__PURE__ */ jsx(Text, { color: "yellow", children: summary })
  ] });
}
function Footer({ mode }) {
  const legend = mode === "list" ? "\u2191\u2193 move   enter edit   n new   d delete   u undo   s save   q quit" : "";
  return /* @__PURE__ */ jsx(Box, { marginTop: 0, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: legend }) });
}
function TableHeader() {
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "  " }),
    /* @__PURE__ */ jsx(Text, { bold: true, children: truncate("HEADER", KEY_COL) }),
    /* @__PURE__ */ jsx(Text, { children: " " }),
    /* @__PURE__ */ jsx(Text, { bold: true, children: truncate("VALUE", VAL_COL) }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "   \u2502" })
  ] });
}
function HeaderRowWrapper({
  row,
  selected,
  isEditing,
  editDraft,
  setEditDraft
}) {
  const deleted = row.state === "deleted";
  const isNew = row.state === "new";
  const isMod = row.state === "modified";
  const marker = isNew ? "+" : isMod ? "*" : deleted ? "-" : " ";
  const keyColor = isNew ? "green" : void 0;
  const valColor = isMod ? "yellow" : isNew ? "green" : void 0;
  const displayKey = truncate(row.key, KEY_COL);
  const displayValue = truncate(row.value, VAL_COL);
  const prefix = selected ? "\u25B8" : " ";
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
    /* @__PURE__ */ jsxs(Text, { inverse: selected, children: [
      prefix,
      " "
    ] }),
    deleted ? /* @__PURE__ */ jsx(Text, { dimColor: true, strikethrough: true, children: displayKey }) : /* @__PURE__ */ jsx(Text, { color: keyColor, inverse: selected, children: displayKey }),
    /* @__PURE__ */ jsx(Text, { inverse: selected, children: " " }),
    isEditing ? /* @__PURE__ */ jsx(TextInput, { value: editDraft, onChange: setEditDraft }) : deleted ? /* @__PURE__ */ jsx(Text, { dimColor: true, strikethrough: true, children: displayValue.padEnd(VAL_COL) }) : /* @__PURE__ */ jsx(Text, { color: valColor, inverse: selected, children: displayValue.padEnd(VAL_COL) }),
    /* @__PURE__ */ jsxs(Text, { inverse: selected, children: [
      " ",
      marker,
      " "
    ] }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" })
  ] });
}
function HeaderEditor({ target, initial, onSave }) {
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
  const clampCursor = useCallback((idx, len) => {
    if (len === 0) return 0;
    return Math.max(0, Math.min(idx, len - 1));
  }, []);
  useInput((input, key) => {
    if (mode === "list") {
      if (key.upArrow) {
        setCursor((c) => clampCursor(c - 1, rows.length));
      } else if (key.downArrow) {
        setCursor((c) => clampCursor(c + 1, rows.length));
      } else if (key.return) {
        const row = rows[cursor];
        if (!row || row.state === "deleted") return;
        setEditDraft(row.value);
        setMode("edit-value");
      } else if (input === "n") {
        setNewKeyDraft("");
        setNewValDraft("");
        setKeyError("");
        setMode("add-key");
      } else if (input === "d") {
        const row = rows[cursor];
        if (!row || row.state === "deleted") return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === "new") {
            next.splice(cursor, 1);
            setCursor((c) => clampCursor(c, next.length));
          } else {
            r.state = "deleted";
            next[cursor] = r;
          }
          return next;
        });
      } else if (input === "u") {
        const row = rows[cursor];
        if (!row) return;
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          if (r.state === "deleted") {
            r.state = r.value !== r.originalValue ? "modified" : "unchanged";
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
        setRows((prev) => {
          const next = [...prev];
          const r = { ...next[cursor] };
          r.value = editDraft;
          if (r.state !== "new") {
            r.state = editDraft === r.originalValue ? "unchanged" : "modified";
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
        const k = newKeyDraft.trim();
        if (!k) {
          setKeyError("Header name cannot be empty");
          return;
        }
        if (rows.some(
          (r) => r.key.toLowerCase() === k.toLowerCase() && r.state !== "deleted"
        )) {
          setKeyError(`"${k}" already exists`);
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
        /* @__PURE__ */ jsx(Text, { bold: true, children: target }),
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
      /* @__PURE__ */ jsx(Text, { bold: true, children: target }),
      "? [y/N]"
    ] }) });
  }
  if (mode === "saved") {
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: /* @__PURE__ */ jsxs(Text, { color: "green", children: [
      "\u2713 Saving ",
      savedCount,
      " changes to ",
      target,
      "\u2026"
    ] }) });
  }
  const isEmpty = rows.length === 0 && mode !== "add-key" && mode !== "add-value";
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(
      Header,
      {
        target,
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
          "No headers set for ",
          target,
          ".",
          " ".repeat(Math.max(0, BOX_WIDTH - 18 - target.length))
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
    ] }) : rows.map(
      (row, i) => React.createElement(HeaderRowWrapper, {
        key: `${row.key}-${i}`,
        row,
        selected: i === cursor,
        isEditing: i === cursor && mode === "edit-value",
        editDraft,
        setEditDraft
      })
    ),
    mode === "add-key" && /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
        /* @__PURE__ */ jsx(Text, { color: "green", children: "+ " }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            value: newKeyDraft,
            onChange: setNewKeyDraft,
            placeholder: "X-My-Header"
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
export {
  HeaderEditor
};
