/**
 * launch-remote-serve.tsx
 *
 * Wires the SSH server event bus to the RemoteServeDashboard TUI.
 * Starts the server, then renders the TUI. The server keeps running
 * until the user presses Q (graceful drain) or the process is killed.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { render, useApp } from 'ink';
import fs from 'fs';
import {
  startRemoteServer,
  serverEvents,
  getActiveSessions,
  disconnectSession,
} from '../utils/ssh-server.js';
import type { SessionSnapshot } from '../utils/ssh-server.js';
import { RemoteServeDashboard } from './RemoteServeDashboard.js';
import type { LogEntry } from './RemoteServeDashboard.js';
import { Logger } from '../utils/logger.js';
import { REMOTE_AUDIT_LOG_PATH } from '../constants.js';

const MAX_LOG = 200;

interface ServerInfo {
  bindAddress: string;
  port: number;
  fingerprint: string;
}

function App({ serverInfo, initialLogs }: { serverInfo: ServerInfo; initialLogs: LogEntry[] }): React.ReactElement {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<SessionSnapshot[]>(() => getActiveSessions());
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => {
      const next = [...prev, { level, message, ts: new Date() }];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  }, []);

  useEffect(() => {
    const onLog = (level: LogEntry['level'], message: string) => addLog(level, message);
    const onOpen = (_s: SessionSnapshot) => setSessions(getActiveSessions());
    const onClose = (_id: string) => setSessions(getActiveSessions());

    serverEvents.on('log', onLog);
    serverEvents.on('session-open', onOpen);
    serverEvents.on('session-close', onClose);

    return () => {
      serverEvents.off('log', onLog);
      serverEvents.off('session-open', onOpen);
      serverEvents.off('session-close', onClose);
    };
  }, [addLog]);

  // Tail the audit log file for repl-command entries from child PTY sessions.
  // Those run in a separate process so they can't emit to serverEvents directly.
  useEffect(() => {
    if (!fs.existsSync(REMOTE_AUDIT_LOG_PATH)) return;

    let offset = fs.statSync(REMOTE_AUDIT_LOG_PATH).size; // start at current EOF
    const watcher = fs.watch(REMOTE_AUDIT_LOG_PATH, () => {
      try {
        const stat = fs.statSync(REMOTE_AUDIT_LOG_PATH);
        if (stat.size <= offset) return; // truncation — ignore
        const buf = Buffer.alloc(stat.size - offset);
        const fd = fs.openSync(REMOTE_AUDIT_LOG_PATH, 'r');
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = stat.size;

        for (const rawLine of buf.toString('utf8').split('\n')) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const entry = JSON.parse(line) as Record<string, unknown>;
            if (entry.event === 'repl-command') {
              addLog('info', `[${entry.identity}] $ ${entry.command}`);
            }
          } catch { /* malformed line */ }
        }
      } catch { /* file disappeared mid-read */ }
    });

    return () => watcher.close();
  }, [addLog]);

  const handleDisconnect = useCallback((id: string) => {
    disconnectSession(id);
  }, []);

  const handleQuit = useCallback(() => {
    // Signal handler in ssh-server will drain sessions
    process.emit('SIGTERM' as any);
    exit();
  }, [exit]);

  return (
    <RemoteServeDashboard
      bindAddress={serverInfo.bindAddress}
      port={serverInfo.port}
      fingerprint={serverInfo.fingerprint}
      sessions={sessions}
      logs={logs}
      onDisconnect={handleDisconnect}
      onQuit={handleQuit}
    />
  );
}

export async function launchRemoteServe(port: number): Promise<void> {
  // Buffer log entries before the TUI mounts so nothing is lost
  const pendingLogs: LogEntry[] = [];
  const bufferLog = (level: LogEntry['level'], message: string) => {
    pendingLogs.push({ level, message, ts: new Date() });
  };
  serverEvents.on('log', bufferLog);

  // Mute the plain Logger — the TUI shows all events via serverEvents
  Logger.isMuted = true;

  let resolveServerInfo!: (info: ServerInfo) => void;
  const serverInfoPromise = new Promise<ServerInfo>((res) => { resolveServerInfo = res; });

  serverEvents.once('listening', (address, actualPort, fingerprint) => {
    resolveServerInfo({ bindAddress: address, port: actualPort, fingerprint });
  });

  const serverPromise = startRemoteServer(port);
  const serverInfo = await serverInfoPromise;

  // Stop buffering — hand off to the TUI
  serverEvents.off('log', bufferLog);

  const { waitUntilExit } = render(<App serverInfo={serverInfo} initialLogs={pendingLogs} />);
  await waitUntilExit();

  Logger.isMuted = false;
  await serverPromise.catch(() => { /* already exiting */ });
}
