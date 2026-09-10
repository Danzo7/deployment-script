import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * RemoteServeDashboard.tsx
 *
 * TUI for `dm remote serve`. Shows:
 *  - Top bar: bind address, port, host key fingerprint, wall clock
 *  - Active sessions table with username, ip, type, connected-at
 *  - Disconnect action (↑↓ to select, D to disconnect, Q to quit)
 *  - Scrollable event log at the bottom
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
// ── Layout ────────────────────────────────────────────────────────────────────
const TERM_W = Math.max(process.stdout.columns ?? 120, 80);
const TERM_H = Math.max(process.stdout.rows ?? 30, 20);
const LOG_PANEL_H = Math.max(8, Math.floor(TERM_H * 0.35));
// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(d) {
    return d.toTimeString().slice(0, 8);
}
function fmtElapsed(from) {
    const secs = Math.floor((Date.now() - from.getTime()) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m === 0)
        return `${s}s`;
    const h = Math.floor(m / 60);
    if (h === 0)
        return `${m}m ${s}s`;
    return `${h}h ${m % 60}m`;
}
function levelColor(level) {
    switch (level) {
        case 'success':
            return 'green';
        case 'warn':
            return 'yellow';
        case 'error':
            return 'red';
        default:
            return 'white';
    }
}
function pad(s, n) {
    if (s.length >= n)
        return s.slice(0, n);
    return s + ' '.repeat(n - s.length);
}
// ── Component ─────────────────────────────────────────────────────────────────
export function RemoteServeDashboard({ bindAddress, port, fingerprint, sessions, logs, onDisconnect, onQuit, }) {
    const { exit } = useApp();
    const [cursor, setCursor] = useState(0);
    const [time, setTime] = useState(() => fmtTime(new Date()));
    const [confirm, setConfirm] = useState(null); // sessionId awaiting confirm
    const [logOffset, setLogOffset] = useState(0);
    // Clock tick
    useEffect(() => {
        const id = setInterval(() => setTime(fmtTime(new Date())), 1000);
        return () => clearInterval(id);
    }, []);
    // Keep cursor in bounds
    useEffect(() => {
        if (cursor >= sessions.length && sessions.length > 0) {
            setCursor(sessions.length - 1);
        }
    }, [sessions.length]);
    // Auto-scroll log to bottom when new entries arrive
    useEffect(() => {
        setLogOffset(0);
    }, [logs.length]);
    useInput((input, key) => {
        if (confirm) {
            if (input === 'y' || input === 'Y') {
                onDisconnect(confirm);
                setConfirm(null);
            }
            else {
                setConfirm(null);
            }
            return;
        }
        if (key.upArrow)
            setCursor((c) => Math.max(0, c - 1));
        if (key.downArrow)
            setCursor((c) => Math.min(Math.max(sessions.length - 1, 0), c + 1));
        if ((input === 'd' || input === 'D') && sessions.length > 0) {
            setConfirm(sessions[cursor]?.id ?? null);
        }
        // Log scroll: PgUp / PgDn
        if (key.pageUp)
            setLogOffset((o) => Math.min(o + LOG_PANEL_H, Math.max(0, logs.length - LOG_PANEL_H)));
        if (key.pageDown)
            setLogOffset((o) => Math.max(0, o - LOG_PANEL_H));
        if (input === 'q' || input === 'Q') {
            onQuit();
            exit();
        }
    });
    // ── Column widths ─────────────────────────────────────────────────────────
    const COL_USER = 18;
    const COL_IP = 18;
    const COL_TYPE = 8;
    const COL_CONN = 10;
    const COL_ID = 6;
    // ── Log slice ─────────────────────────────────────────────────────────────
    const visibleLogs = logs.slice(Math.max(0, logs.length - LOG_PANEL_H - logOffset), logs.length - logOffset || undefined);
    // ── Separator ─────────────────────────────────────────────────────────────
    const sep = _jsx(Text, { dimColor: true, children: '─'.repeat(TERM_W) });
    return (_jsxs(Box, { flexDirection: "column", width: TERM_W, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: TERM_W, children: [_jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsx(Text, { bold: true, color: "yellow", children: "dm remote" }), _jsx(Text, { dimColor: true, children: "|" }), _jsxs(Text, { children: [bindAddress, ":", port] }), _jsx(Text, { dimColor: true, children: "|" }), _jsx(Text, { dimColor: true, children: "fp: " }), _jsxs(Text, { color: "cyan", children: [fingerprint.slice(0, 24), "\u2026"] })] }), _jsx(Text, { dimColor: true, children: time })] }), sep, _jsxs(Box, { flexDirection: "column", width: TERM_W, children: [_jsxs(Box, { flexDirection: "row", gap: 2, marginBottom: 0, children: [_jsx(Text, { bold: true, color: "yellow", children: "Active Sessions" }), _jsxs(Text, { dimColor: true, children: ["(", sessions.length, ")"] })] }), _jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { dimColor: true, bold: true, children: pad('ID', COL_ID) }), _jsx(Text, { dimColor: true, bold: true, children: '  ' }), _jsx(Text, { dimColor: true, bold: true, children: pad('User', COL_USER) }), _jsx(Text, { dimColor: true, bold: true, children: pad('IP', COL_IP) }), _jsx(Text, { dimColor: true, bold: true, children: pad('Type', COL_TYPE) }), _jsx(Text, { dimColor: true, bold: true, children: pad('Uptime', COL_CONN) })] }), _jsx(Text, { dimColor: true, children: '─'.repeat(TERM_W) }), sessions.length === 0 ? (_jsx(Box, { marginTop: 1, marginLeft: 2, children: _jsx(Text, { dimColor: true, children: "No active sessions" }) })) : (sessions.map((s, i) => {
                        const selected = i === cursor;
                        return (_jsxs(Box, { flexDirection: "row", children: [selected ? (_jsx(Text, { bold: true, color: "yellow", children: "\u258C\u258C" })) : (_jsx(Text, { children: '  ' })), _jsx(Text, { color: selected ? 'yellow' : 'white', bold: selected, children: pad(s.id, COL_ID) }), _jsx(Text, { color: selected ? 'yellow' : 'white', bold: selected, children: '  ' }), _jsx(Text, { color: selected ? 'yellow' : 'white', bold: selected, children: pad(s.identity, COL_USER) }), _jsx(Text, { color: selected ? 'yellow' : 'gray', children: pad(s.ip, COL_IP) }), _jsx(Text, { dimColor: true, children: pad(s.sessionType, COL_TYPE) }), _jsx(Text, { dimColor: true, children: fmtElapsed(s.connectedAt) })] }, s.id));
                    }))] }), sep, confirm && (_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: "yellow", children: ["Disconnect session ", confirm, " (", sessions.find((s) => s.id === confirm)?.identity, ")? [y/N]", ' '] }) })), _jsxs(Box, { flexDirection: "column", width: TERM_W, height: LOG_PANEL_H, children: [_jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsx(Text, { bold: true, color: "yellow", children: "Event Log" }), logOffset > 0 && _jsx(Text, { dimColor: true, children: "(scrolled \u2014 PgDn to return)" })] }), _jsx(Text, { dimColor: true, children: '─'.repeat(TERM_W) }), visibleLogs.map((entry, i) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: fmtTime(entry.ts) }), _jsx(Text, { color: levelColor(entry.level), children: entry.message })] }, i)))] }), sep, _jsxs(Box, { flexDirection: "row", gap: 3, children: [_jsx(Text, { dimColor: true, children: "\u2191\u2193 select" }), _jsx(Text, { dimColor: true, children: "D disconnect" }), _jsx(Text, { dimColor: true, children: "PgUp/PgDn scroll log" }), _jsx(Text, { dimColor: true, children: "Q quit" })] })] }));
}
