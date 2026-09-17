/**
 * RemoteServeDashboard index.tsx
 *
 * Full-screen TUI for `dm remote serve`. Shows:
 *  - Server status bar with bind address, port, fingerprint
 *  - Active sessions table with full details
 *  - Event log panel at the bottom
 *  - Keyboard shortcuts bar
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';
import type { LogEntry, RemoteServeDashboardProps } from './types.js';
import { TERM_W, TERM_H } from '../../utils/constants.js';
import { useCursor } from '../../hooks/useCursor.js';
import { ServerTopBar } from './components/ServerTopBar.js';
import { SessionsTable } from './components/SessionsTable.js';
import { LogPanel } from './components/LogPanel.js';
import { Keybar } from './components/Keybar.js';

// Re-export types
export type { LogEntry, RemoteServeDashboardProps };

// ── Layout calculations ───────────────────────────────────────────────────────

// Chrome rows: TopBar(3) + SessionsHeader(3) + Separator(1) + Keybar(2) = 9
const CHROME_ROWS = 9;
// Reserve 40% of remaining space for logs, minimum 8 lines
const LOG_PANEL_H = Math.max(8, Math.floor((TERM_H - CHROME_ROWS) * 0.4));
// Sessions table gets the rest
const SESSIONS_TABLE_H = Math.max(5, TERM_H - CHROME_ROWS - LOG_PANEL_H - 1);

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
  const exit = usePageExit();
  const { cursor, setCursor } = useCursor(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [logOffset, setLogOffset] = useState(0);

  // Keep cursor in bounds
  useEffect(() => {
    if (cursor >= sessions.length && sessions.length > 0) {
      setCursor(sessions.length - 1);
    }
  }, [sessions.length, cursor, setCursor]);

  // Auto-scroll log to bottom when new entries arrive
  useEffect(() => {
    setLogOffset(0);
  }, [logs.length]);

  useInput((input, key) => {
    // Confirmation dialog active
    if (confirm) {
      if (input === 'y' || input === 'Y') {
        onDisconnect(confirm);
        setConfirm(null);
      } else if (input === 'n' || input === 'N' || key.escape) {
        setConfirm(null);
      }
      return;
    }

    // Session navigation
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(Math.max(sessions.length - 1, 0), c + 1));
    }

    // Disconnect session
    if ((input === 'd' || input === 'D') && sessions.length > 0) {
      const session = sessions[cursor];
      if (session) {
        setConfirm(session.id);
      }
    }

    // Log scroll
    if (key.pageUp) {
      setLogOffset((o) => {
        const maxOffset = Math.max(0, logs.length - (LOG_PANEL_H - 2));
        return Math.min(o + LOG_PANEL_H, maxOffset);
      });
    } else if (key.pageDown) {
      setLogOffset((o) => Math.max(0, o - LOG_PANEL_H));
    }

    // Quit
    if (input === 'q' || input === 'Q') {
      onQuit();
      exit();
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" width={TERM_W} height={TERM_H}>
      {/* Server status bar */}
      <ServerTopBar
        bindAddress={bindAddress}
        port={port}
        fingerprint={fingerprint}
      />

      {/* Confirm disconnect dialog */}
      {confirm && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={2}
          paddingY={1}
          width={Math.min(60, TERM_W - 4)}
          alignSelf="center"
        >
          <Text color="yellow" bold>
            Disconnect Session
          </Text>
          <Text>
            Disconnect session {confirm} (
            {sessions.find((s) => s.id === confirm)?.identity})?
          </Text>
          <Box marginTop={1} flexDirection="row">
            <Text bold color="white">
              y
            </Text>
            <Text dimColor> confirm  </Text>
            <Text bold color="white">
              n
            </Text>
            <Text dimColor> cancel</Text>
          </Box>
        </Box>
      )}

      {/* Sessions table */}
      <Box flexDirection="column" marginTop={confirm ? 0 : 1}>
        <SessionsTable
          sessions={sessions}
          cursor={cursor}
          maxVisible={SESSIONS_TABLE_H}
        />
      </Box>

      {/* Separator */}
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(TERM_W)}</Text>
      </Box>

      {/* Event log */}
      <Box flexDirection="column">
        <LogPanel
          logs={logs}
          scrollOffset={logOffset}
          maxVisible={LOG_PANEL_H}
        />
      </Box>

      {/* Keyboard shortcuts */}
      <Keybar hasActiveSessions={sessions.length > 0} />
    </Box>
  );
}
