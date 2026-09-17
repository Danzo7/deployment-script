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
import type { SessionSnapshot } from '../../../utils/ssh-server.js';
import { RemoteServeDashboard, type LogEntry } from './index.js';
import { REMOTE_AUDIT_LOG_PATH } from '../../../constants.js';

const MAX_LOG = 200;

interface ServerInfo {
  bindAddress: string;
  port: number;
  fingerprint: string;
}

export function RemoteServeAdapter(): React.ReactElement {
  const { port } = usePageParams<PageId.RemoteServe>();
  const exit = usePageExit();
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => {
      const next = [...prev, { level, message, ts: new Date() }];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  }, []);

  // Start server on mount
  useEffect(() => {
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
  }, [port, addLog]);

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
    disconnectSession(id);
  }, []);

  const handleQuit = useCallback(() => {
    // Signal handler in ssh-server will drain sessions
    process.emit('SIGTERM' as any);
    exit();
  }, [exit]);

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
