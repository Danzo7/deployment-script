/**
 * launch-remote-serve.tsx
 *
 * Wires the SSH server event bus to the RemoteServeDashboard TUI.
 * Starts the server, then renders the TUI. The server keeps running
 * until the user presses Q (graceful drain) or the process is killed.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { render, useApp } from 'ink';
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

const MAX_LOG = 200;

interface ServerInfo {
  bindAddress: string;
  port: number;
  fingerprint: string;
}

function App({ serverInfo }: { serverInfo: ServerInfo }): React.ReactElement {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<SessionSnapshot[]>(() => getActiveSessions());
  const [logs, setLogs] = useState<LogEntry[]>([]);

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
  // Mute the plain Logger — the TUI shows all events via serverEvents
  Logger.isMuted = true;

  let resolveServerInfo!: (info: ServerInfo) => void;
  const serverInfoPromise = new Promise<ServerInfo>((res) => { resolveServerInfo = res; });

  // Start server in background; capture listening event for TUI init
  serverEvents.once('listening', (address, actualPort, fingerprint) => {
    resolveServerInfo({ bindAddress: address, port: actualPort, fingerprint });
  });

  // Start the server (non-blocking from our perspective — it awaits internally)
  const serverPromise = startRemoteServer(port);

  const serverInfo = await serverInfoPromise;

  const { waitUntilExit } = render(<App serverInfo={serverInfo} />);
  await waitUntilExit();

  Logger.isMuted = false;

  // Wait for the server to fully drain (SIGTERM was emitted by handleQuit)
  await serverPromise.catch(() => { /* already exiting */ });
}
