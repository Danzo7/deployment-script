// ─── Remote IPC Server ────────────────────────────────────────────────────────
//
// Provides IPC communication for the SSH remote server, allowing external
// clients (TUI, CLI commands) to query status and control the server without
// needing to embed it in-process.
//
// Uses Unix domain sockets on Linux/Mac and named pipes on Windows.
// ─────────────────────────────────────────────────────────────────────────────

import net from 'net';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { SessionSnapshot } from './ssh-server.js';

export interface ServerStatus {
  running: boolean;
  bindAddress: string;
  port: number;
  fingerprint: string;
  activeSessions: number;
  uptime: number;
}

export interface IpcMessage {
  type: 'request' | 'response' | 'event';
  id?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
  event?: string;
  data?: any;
}

export class RemoteIpcServer extends EventEmitter {
  private server: net.Server | null = null;
  private socketPath: string;
  private clients: Set<net.Socket> = new Set();
  private startTime: number = Date.now();
  private serverStatus: Omit<ServerStatus, 'uptime' | 'activeSessions'> = {
    running: true,
    bindAddress: 'localhost',
    port: 2022,
    fingerprint: '',
  };

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
    this.setMaxListeners(20); // Increase if needed
  }

  /**
   * Update server status information
   */
  updateStatus(status: Partial<ServerStatus>): void {
    this.serverStatus = { ...this.serverStatus, ...status };
  }

  /**
   * Start the IPC server
   */
  async start(): Promise<void> {
    // Remove stale socket if it exists
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }

    // Ensure directory exists
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        // Set socket permissions (Unix only)
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(this.socketPath, 0o600);
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
    });
  }

  /**
   * Stop the IPC server
   */
  async stop(): Promise<void> {
    if (!this.server) return;

    // Close all client connections
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.server!.close(() => {
        // Clean up socket file
        if (fs.existsSync(this.socketPath)) {
          try {
            fs.unlinkSync(this.socketPath);
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
    });
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastEvent(event: string, data: any): void {
    const message: IpcMessage = {
      type: 'event',
      event,
      data,
    };

    const payload = JSON.stringify(message) + '\n';

    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected, will be removed by connection handler
      }
    }
  }

  /**
   * Handle incoming client connection
   */
  private handleConnection(socket: net.Socket): void {
    this.clients.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete lines (messages are newline-delimited JSON)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (line.trim()) {
          try {
            const message = JSON.parse(line) as IpcMessage;
            this.handleMessage(socket, message);
          } catch (err) {
            this.sendError(socket, 'unknown', 'Invalid JSON');
          }
        }
      }
    });

    socket.on('error', () => {
      this.clients.delete(socket);
    });

    socket.on('close', () => {
      this.clients.delete(socket);
    });
  }

  /**
   * Handle incoming IPC message
   */
  private handleMessage(socket: net.Socket, message: IpcMessage): void {
    if (message.type !== 'request') {
      this.sendError(socket, message.id, 'Invalid message type');
      return;
    }

    const { id, method, params } = message;

    switch (method) {
      case 'getStatus':
        this.handleGetStatus(socket, id!);
        break;

      case 'getSessions':
        this.handleGetSessions(socket, id!);
        break;

      case 'disconnectSession':
        this.handleDisconnectSession(socket, id!, params?.sessionId);
        break;

      case 'shutdown':
        this.handleShutdown(socket, id!);
        break;

      case 'ping':
        this.sendResponse(socket, id!, { pong: true });
        break;

      default:
        this.sendError(socket, id, `Unknown method: ${method}`);
    }
  }

  /**
   * Handle getStatus request
   */
  private handleGetStatus(socket: net.Socket, id: string): void {
    const status: ServerStatus = {
      ...this.serverStatus,
      uptime: Date.now() - this.startTime,
      activeSessions: 0, // Will be set by caller
    };

    this.emit('status-request', (sessions: SessionSnapshot[]) => {
      status.activeSessions = sessions.length;
      this.sendResponse(socket, id, status);
    });
  }

  /**
   * Handle getSessions request
   */
  private handleGetSessions(socket: net.Socket, id: string): void {
    this.emit('sessions-request', (sessions: SessionSnapshot[]) => {
      this.sendResponse(socket, id, { sessions });
    });
  }

  /**
   * Handle disconnectSession request
   */
  private handleDisconnectSession(
    socket: net.Socket,
    id: string,
    sessionId?: string
  ): void {
    if (!sessionId) {
      this.sendError(socket, id, 'sessionId required');
      return;
    }

    this.emit('disconnect-request', sessionId, (success: boolean) => {
      this.sendResponse(socket, id, { success });
    });
  }

  /**
   * Handle shutdown request
   */
  private handleShutdown(socket: net.Socket, id: string): void {
    this.sendResponse(socket, id, { success: true });
    this.emit('shutdown-request');
  }

  /**
   * Send response to client
   */
  private sendResponse(socket: net.Socket, id: string, result: any): void {
    const message: IpcMessage = {
      type: 'response',
      id,
      result,
    };

    try {
      socket.write(JSON.stringify(message) + '\n');
    } catch {
      /* client disconnected */
    }
  }

  /**
   * Send error to client
   */
  private sendError(
    socket: net.Socket,
    id: string | undefined,
    error: string
  ): void {
    const message: IpcMessage = {
      type: 'response',
      id: id ?? 'unknown',
      error,
    };

    try {
      socket.write(JSON.stringify(message) + '\n');
    } catch {
      /* client disconnected */
    }
  }
}
