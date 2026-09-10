import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
const TERM_W = Math.max(process.stdout.columns ?? 120, 80);
const TERM_H = Math.max(process.stdout.rows ?? 30, 20);
const LOG_PANEL_H = Math.max(8, Math.floor(TERM_H * 0.35));
function fmtTime(d) {
  return d.toTimeString().slice(0, 8);
}
function fmtElapsed(from) {
  const secs = Math.floor((Date.now() - from.getTime()) / 1e3);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m ${s}s`;
  return `${h}h ${m % 60}m`;
}
function levelColor(level) {
  switch (level) {
    case "success":
      return "green";
    case "warn":
      return "yellow";
    case "error":
      return "red";
    default:
      return "white";
  }
}
function pad(s, n) {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}
function RemoteServeDashboard({
  bindAddress,
  port,
  fingerprint,
  sessions,
  logs,
  onDisconnect,
  onQuit
}) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [time, setTime] = useState(() => fmtTime(/* @__PURE__ */ new Date()));
  const [confirm, setConfirm] = useState(null);
  const [logOffset, setLogOffset] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTime(fmtTime(/* @__PURE__ */ new Date())), 1e3);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (cursor >= sessions.length && sessions.length > 0) {
      setCursor(sessions.length - 1);
    }
  }, [sessions.length]);
  useEffect(() => {
    setLogOffset(0);
  }, [logs.length]);
  useInput((input, key) => {
    if (confirm) {
      if (input === "y" || input === "Y") {
        onDisconnect(confirm);
        setConfirm(null);
      } else {
        setConfirm(null);
      }
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow)
      setCursor((c) => Math.min(Math.max(sessions.length - 1, 0), c + 1));
    if ((input === "d" || input === "D") && sessions.length > 0) {
      setConfirm(sessions[cursor]?.id ?? null);
    }
    if (key.pageUp)
      setLogOffset(
        (o) => Math.min(o + LOG_PANEL_H, Math.max(0, logs.length - LOG_PANEL_H))
      );
    if (key.pageDown) setLogOffset((o) => Math.max(0, o - LOG_PANEL_H));
    if (input === "q" || input === "Q") {
      onQuit();
      exit();
    }
  });
  const COL_USER = 18;
  const COL_IP = 18;
  const COL_TYPE = 8;
  const COL_CONN = 10;
  const COL_ID = 6;
  const visibleLogs = logs.slice(
    Math.max(0, logs.length - LOG_PANEL_H - logOffset),
    logs.length - logOffset || void 0
  );
  const sep = /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2500".repeat(TERM_W) });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: TERM_W, children: [
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: TERM_W, children: [
      /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "dm remote" }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "|" }),
        /* @__PURE__ */ jsxs(Text, { children: [
          bindAddress,
          ":",
          port
        ] }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "|" }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: "fp: " }),
        /* @__PURE__ */ jsxs(Text, { color: "cyan", children: [
          fingerprint.slice(0, 24),
          "\u2026"
        ] })
      ] }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: time })
    ] }),
    sep,
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: TERM_W, children: [
      /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, marginBottom: 0, children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "Active Sessions" }),
        /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "(",
          sessions.length,
          ")"
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Box, { flexDirection: "row", children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: pad("ID", COL_ID) }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: "  " }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: pad("User", COL_USER) }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: pad("IP", COL_IP) }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: pad("Type", COL_TYPE) }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, bold: true, children: pad("Uptime", COL_CONN) })
      ] }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2500".repeat(TERM_W) }),
      sessions.length === 0 ? /* @__PURE__ */ jsx(Box, { marginTop: 1, marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "No active sessions" }) }) : sessions.map((s, i) => {
        const selected = i === cursor;
        return /* @__PURE__ */ jsxs(Box, { flexDirection: "row", children: [
          selected ? /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "\u258C\u258C" }) : /* @__PURE__ */ jsx(Text, { children: "  " }),
          /* @__PURE__ */ jsx(Text, { color: selected ? "yellow" : "white", bold: selected, children: pad(s.id, COL_ID) }),
          /* @__PURE__ */ jsx(Text, { color: selected ? "yellow" : "white", bold: selected, children: "  " }),
          /* @__PURE__ */ jsx(Text, { color: selected ? "yellow" : "white", bold: selected, children: pad(s.identity, COL_USER) }),
          /* @__PURE__ */ jsx(Text, { color: selected ? "yellow" : "gray", children: pad(s.ip, COL_IP) }),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: pad(s.sessionType, COL_TYPE) }),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: fmtElapsed(s.connectedAt) })
        ] }, s.id);
      })
    ] }),
    sep,
    confirm && /* @__PURE__ */ jsx(Box, { marginBottom: 1, children: /* @__PURE__ */ jsxs(Text, { color: "yellow", children: [
      "Disconnect session ",
      confirm,
      " (",
      sessions.find((s) => s.id === confirm)?.identity,
      ")? [y/N]",
      " "
    ] }) }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: TERM_W, height: LOG_PANEL_H, children: [
      /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "Event Log" }),
        logOffset > 0 && /* @__PURE__ */ jsx(Text, { dimColor: true, children: "(scrolled \u2014 PgDn to return)" })
      ] }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2500".repeat(TERM_W) }),
      visibleLogs.map((entry, i) => /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: fmtTime(entry.ts) }),
        /* @__PURE__ */ jsx(Text, { color: levelColor(entry.level), children: entry.message })
      ] }, i))
    ] }),
    sep,
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 3, children: [
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2191\u2193 select" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "D disconnect" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "PgUp/PgDn scroll log" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Q quit" })
    ] })
  ] });
}
export {
  RemoteServeDashboard
};
