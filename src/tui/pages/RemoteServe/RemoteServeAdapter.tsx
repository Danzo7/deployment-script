import React, { useState, useEffect, useCallback } from 'react';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';
import { usePageParams } from '../../../app/navigation/use-navigation.js';
import { PageId } from '../../../app/navigation/types.js';
import fs from 'fs';
import {
  startRemoteServer,
  serverEvents,
  getActiveSessions,
  disconnectSession,
} from '../../../utils/ssh-server.js';
import { RemoteIpcClient } from '../../../utils/remote-ipc-client.js';
import type { SessionSnapshot } from '../../../utils/ssh-server.js';
import { RemoteServeDashboard, type LogEntry } from './index.js';
import { REMOTE_AUDIT_LOG_PATH, REMOTE_IPC_SOCKET_PATH } from '../../../constants.js';

const MAX_LOG = 200;

interface ServerInfo {
  bindAddress: string;
  port: number;
  fingerprint: string;
}

export function RemoteServeAdapter(): React.ReactElement {
  const { port, legacyMode = false } = usePageParams<PageId.RemoteServe>();
  const exit = usePageExit();
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ipcClient, setIpcClient] = useState<RemoteIpcClient | null>(null);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => {
      const next = [...prev, { level, message, ts: new Date() }];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  }, []);

  // Start server or connect via IPC
  useEffect(() => {
    if (legacyMode) {
      // Legacy mode: start server inline (old behavior)
      return startLegacyMode();
    } else {
      // New mode: connect to running server via IPC
      return startIpcMode();
    }
  }, [port, legacyMode, addLog]);

  // Legacy mode: Start server inline
  function startLegacyMode() {
    let serverPromise: Promise<void> | null = null;

    const onLog = (level: LogEntry['level'], message: string) =>
      addLog(level, message);
    
    const onListening = (address: string, actualPort: number, fingerprint: string) => {
      setServerInfo({ bindAddress: address, port: actualPort, fingerprint });
    };

    const onOpen = (_s: SessionSnapshot) => setSessions(getActiveSessions());
    const onClose = (_id: string) => setSessions(getActiveSessions());

    serverEvents.on('log', onLog);
    serverEvents.once('listening', onListening);
    serverEvents.on('session-open', onOpen);
    serverEvents.on('session-close', onClose);

    serverPromise = startRemoteServer(port);

    return () => {
      serverEvents.off('log', onLog);
      serverEvents.off('session-open', onOpen);
      serverEvents.off('session-close', onClose);
      
      if (serverPromise) {
        serverPromise.catch(() => {
          /* already exiting */
        });
      }
    };
  }

  // IPC mode: Connect to existing server
  function startIpcMode() {
    const client = new RemoteIpcClient(REMOTE_IPC_SOCKET_PATH);

    // Handle events from server
    client.on('log', (data: { level: LogEntry['level']; message: string }) => {
      addLog(data.level, data.message);
    });

    client.on('session-open', () => {
      // Refresh sessions
      client.getSessions().then(setSessions).catch(() => {});
    });

    client.on('session-close', () => {
      // Refresh sessions
      client.getSessions().then(setSessions).catch(() => {});
    });

    client.on('disconnected', () => {
      addLog('error', 'Lost connection to server');
    });

    client.on('error', (err: Error) => {
      addLog('error', `IPC error: ${err.message}`);
    });

    // Connect and fetch initial state
    client
      .connect()
      .then(async () => {
        const status = await client.getStatus();
        setServerInfo({
          bindAddress: status.bindAddress,
          port: status.port,
          fingerprint: status.fingerprint,
        });

        const sessions = await client.getSessions();
        setSessions(sessions);

        addLog('success', 'Connected to remote server');
      })
      .catch((err: Error) => {
        addLog('error', `Failed to connect: ${err.message}`);
      });

    setIpcClient(client);

    return () => {
      client.disconnect();
    };
  }

  // Tail audit log
  useEffect(() => {
    if (!fs.existsSync(REMOTE_AUDIT_LOG_PATH)) return;

    let offset = fs.statSync(REMOTE_AUDIT_LOG_PATH).size;
    const watcher = fs.watch(REMOTE_AUDIT_LOG_PATH, () => {
      try {
        const stat = fs.statSync(REMOTE_AUDIT_LOG_PATH);
        if (stat.size <= offset) return;
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
              const sessionType = entry.sessionType || 'shell';
              const typeLabel = sessionType === 'exec' ? '[exec]' : '[shell]';
              addLog('info', `${typeLabel} [${entry.identity}] $ ${entry.command}`);
            } else if (entry.event === 'exec') {
              addLog('info', `[exec] [${entry.identity}] $ ${entry.command}`);
            }
          } catch {
            /* malformed line */
          }
        }
      } catch {
        /* file disappeared mid-read */
      }
    });

    return () => watcher.close();
  }, [addLog]);

  const handleDisconnect = useCallback((id: string) => {
    if (ipcClient) {
      ipcClient.disconnectSession(id);
    } else {
      disconnectSession(id);
    }
  }, [ipcClient]);

  const handleQuit = useCallback(() => {
    if (legacyMode) {
      // In legacy mode, signal server shutdown
      process.emit('SIGTERM' as any);
    }
    // In IPC mode, just exit TUI (server keeps running)
    exit();
  }, [exit, legacyMode]);

  if (!serverInfo) {
    return <></>;
  }

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
