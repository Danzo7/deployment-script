/** Remote Serve Dashboard types */

import type { SessionSnapshot } from '../../../utils/ssh-server.js';

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
