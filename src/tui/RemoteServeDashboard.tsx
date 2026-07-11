/**
 * RemoteServeDashboard.tsx
 *
 * TUI for `dm remote serve`. Shows:
 *  - Top bar: bind address, port, host key fingerprint, wall clock
 *  - Active sessions table with username, ip, type, connected-at
 *  - Disconnect action (↑↓ to select, D to disconnect, Q to quit)
 *  - Scrollable event log at the bottom
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { SessionSnapshot } from '../utils/ssh-server.js';

// ── Layout ────────────────────────────────────────────────────────────────────

const TERM_W = Math.max(process.stdout.columns ?? 120, 80);
const TERM_H = Math.max(process.stdout.rows ?? 30, 20);
const LOG_PANEL_H = Math.max(8, Math.floor(TERM_H * 0.35));

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  ts: Date;
}

export interface RemoteServeDashboardProps {
  bindAddress: string;
  port: number;
  fingerprint: string;
  sessions: SessionSnapshot[];
  logs: LogEntry[];
  onDisconnect: (sessionId: string) => void;
  onQuit: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

function fmtElapsed(from: Date): string {
  const secs = Math.floor((Date.now() - from.getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m ${s}s`;
  return `${h}h ${m % 60}m`;
}

function levelColor(level: LogEntry['level']): string {
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

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RemoteServeDashboard({
  bindAddress,
  port,
  fingerprint,
  sessions,
  logs,
  onDisconnect,
  onQuit,
}: RemoteServeDashboardProps): React.ReactElement {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [time, setTime] = useState(() => fmtTime(new Date()));
  const [confirm, setConfirm] = useState<string | null>(null); // sessionId awaiting confirm
  const [logOffset, setLogOffset] = useState(0);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTime(fmtTime(new Date())), 1_000);
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
      } else {
        setConfirm(null);
      }
      return;
    }

    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow)
      setCursor((c) => Math.min(Math.max(sessions.length - 1, 0), c + 1));

    if ((input === 'd' || input === 'D') && sessions.length > 0) {
      setConfirm(sessions[cursor]?.id ?? null);
    }

    // Log scroll: PgUp / PgDn
    if (key.pageUp)
      setLogOffset((o) =>
        Math.min(o + LOG_PANEL_H, Math.max(0, logs.length - LOG_PANEL_H))
      );
    if (key.pageDown) setLogOffset((o) => Math.max(0, o - LOG_PANEL_H));

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
  const visibleLogs = logs.slice(
    Math.max(0, logs.length - LOG_PANEL_H - logOffset),
    logs.length - logOffset || undefined
  );

  // ── Separator ─────────────────────────────────────────────────────────────
  const sep = <Text dimColor>{'─'.repeat(TERM_W)}</Text>;

  return (
    <Box flexDirection="column" width={TERM_W}>
      {/* ── Top bar ── */}
      <Box flexDirection="row" justifyContent="space-between" width={TERM_W}>
        <Box flexDirection="row" gap={2}>
          <Text bold color="yellow">
            dm remote
          </Text>
          <Text dimColor>|</Text>
          <Text>
            {bindAddress}:{port}
          </Text>
          <Text dimColor>|</Text>
          <Text dimColor>fp: </Text>
          <Text color="cyan">{fingerprint.slice(0, 24)}…</Text>
        </Box>
        <Text dimColor>{time}</Text>
      </Box>
      {sep}

      {/* ── Sessions panel ── */}
      <Box flexDirection="column" width={TERM_W}>
        <Box flexDirection="row" gap={2} marginBottom={0}>
          <Text bold color="yellow">
            Active Sessions
          </Text>
          <Text dimColor>({sessions.length})</Text>
        </Box>

        {/* Header row */}
        <Box flexDirection="row">
          <Text dimColor bold>
            {pad('ID', COL_ID)}
          </Text>
          <Text dimColor bold>
            {'  '}
          </Text>
          <Text dimColor bold>
            {pad('User', COL_USER)}
          </Text>
          <Text dimColor bold>
            {pad('IP', COL_IP)}
          </Text>
          <Text dimColor bold>
            {pad('Type', COL_TYPE)}
          </Text>
          <Text dimColor bold>
            {pad('Uptime', COL_CONN)}
          </Text>
        </Box>
        <Text dimColor>{'─'.repeat(TERM_W)}</Text>

        {sessions.length === 0 ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>No active sessions</Text>
          </Box>
        ) : (
          sessions.map((s, i) => {
            const selected = i === cursor;
            return (
              <Box key={s.id} flexDirection="row">
                {selected ? (
                  <Text bold color="yellow">
                    ▌▌
                  </Text>
                ) : (
                  <Text>{'  '}</Text>
                )}
                <Text color={selected ? 'yellow' : 'white'} bold={selected}>
                  {pad(s.id, COL_ID)}
                </Text>
                <Text color={selected ? 'yellow' : 'white'} bold={selected}>
                  {'  '}
                </Text>
                <Text color={selected ? 'yellow' : 'white'} bold={selected}>
                  {pad(s.identity, COL_USER)}
                </Text>
                <Text color={selected ? 'yellow' : 'gray'}>
                  {pad(s.ip, COL_IP)}
                </Text>
                <Text dimColor>{pad(s.sessionType, COL_TYPE)}</Text>
                <Text dimColor>{fmtElapsed(s.connectedAt)}</Text>
              </Box>
            );
          })
        )}
      </Box>
      {sep}

      {/* ── Confirm disconnect prompt ── */}
      {confirm && (
        <Box marginBottom={1}>
          <Text color="yellow">
            Disconnect session {confirm} (
            {sessions.find((s) => s.id === confirm)?.identity})? [y/N]{' '}
          </Text>
        </Box>
      )}

      {/* ── Log panel ── */}
      <Box flexDirection="column" width={TERM_W} height={LOG_PANEL_H}>
        <Box flexDirection="row" gap={2}>
          <Text bold color="yellow">
            Event Log
          </Text>
          {logOffset > 0 && <Text dimColor>(scrolled — PgDn to return)</Text>}
        </Box>
        <Text dimColor>{'─'.repeat(TERM_W)}</Text>
        {visibleLogs.map((entry, i) => (
          <Box key={i} flexDirection="row" gap={1}>
            <Text dimColor>{fmtTime(entry.ts)}</Text>
            <Text color={levelColor(entry.level)}>{entry.message}</Text>
          </Box>
        ))}
      </Box>
      {sep}

      {/* ── Key hints ── */}
      <Box flexDirection="row" gap={3}>
        <Text dimColor>↑↓ select</Text>
        <Text dimColor>D disconnect</Text>
        <Text dimColor>PgUp/PgDn scroll log</Text>
        <Text dimColor>Q quit</Text>
      </Box>
    </Box>
  );
}
