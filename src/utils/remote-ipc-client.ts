// ─── Remote IPC Client ────────────────────────────────────────────────────────
//
// Client for connecting to the Remote IPC Server. Used by TUI and CLI
// commands to interact with a running SSH server.
// ─────────────────────────────────────────────────────────────────────────────

import net from 'net';
import { EventEmitter } from 'events';
import type { IpcMessage, ServerStatus } from './remote-ipc-server.js';
import type { SessionSnapshot } from './ssh-server.js';

export class RemoteIpcClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private socketPath: string;
  private connected = false;
  private messageId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();
  private buffer = '';

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
    this.setMaxListeners(20); // Increase if needed
  }

  /**
   * Connect to the IPC server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });

      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        } else {
          this.emit('error', err);
        }
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        
        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
      });
    });
  }

  /**
   * Disconnect from the IPC server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get server status
   */
  async getStatus(): Promise<ServerStatus> {
    return this.sendRequest('getStatus');
  }

  /**
   * Get active sessions
   */
  async getSessions(): Promise<SessionSnapshot[]> {
    const result = await this.sendRequest('getSessions');
    return result.sessions;
  }

  /**
   * Disconnect a session
   */
  async disconnectSession(sessionId: string): Promise<boolean> {
    const result = await this.sendRequest('disconnectSession', { sessionId });
    return result.success;
  }

  /**
   * Request server shutdown
   */
  async shutdown(): Promise<void> {
    await this.sendRequest('shutdown');
  }

  /**
   * Ping the server
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.sendRequest('ping');
      return result.pong === true;
    } catch {
      return false;
    }
  }

  /**
   * Send a request to the server
   */
  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected to IPC server');
    }

    const id = `req-${++this.messageId}`;
    const message: IpcMessage = {
      type: 'request',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.socket!.write(JSON.stringify(message) + '\n');
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err);
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming data
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.trim()) {
        try {
          const message = JSON.parse(line) as IpcMessage;
          this.handleMessage(message);
        } catch {
          /* ignore malformed messages */
        }
      }
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: IpcMessage): void {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.id!);
      if (pending) {
        this.pendingRequests.delete(message.id!);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.type === 'event') {
      this.emit(message.event!, message.data);
    }
  }
}
