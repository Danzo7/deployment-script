import fs from 'fs';
import type { SshConnection } from './ssh-connection.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LogEntry {
  ts: Date;
  method: string;
  uri: string;
  status: number;
  bytes: number;
  responseTime?: number; // seconds, from $request_time — only present in dm_json format
  remoteAddr: string;
}

export interface LogWindow {
  entries: LogEntry[];
  /** Rolling req/s over the last 60 s */
  reqPerSec: number;
  /** Status code distribution over the window */
  statusDist: { s2xx: number; s3xx: number; s4xx: number; s5xx: number };
  /** p50 / p95 response time in ms — undefined when format lacks $request_time */
  p50ms?: number;
  p95ms?: number;
  /** True when we successfully parsed at least one line */
  hasData: boolean;
  /** Non-empty when we couldn't read the log at all */
  error?: string;
  /** True when the log exists but no $request_time field was found */
  noResponseTime?: boolean;
  /** The log file path being tailed — useful for debugging */
  logPath: string;
}

// ─── Log-format parsers ─────────────────────────────────────────────────────

/**
 * Try to parse a JSON-lines entry emitted by the recommended dm_json format:
 *   log_format dm_json '{"ts":"$time_iso8601","method":"$request_method",
 *     "uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,
 *     "rt":$request_time,"addr":"$remote_addr"}';
 */
function parseJsonLine(raw: string): LogEntry | null {
  try {
    const o = JSON.parse(raw);
    if (!o.status) return null;
    return {
      ts: new Date(o.ts ?? Date.now()),
      method: o.method ?? '-',
      uri: o.uri ?? '/',
      status: Number(o.status),
      bytes: Number(o.bytes ?? 0),
      responseTime: o.rt !== undefined && o.rt !== '-' ? Number(o.rt) : undefined,
      remoteAddr: o.addr ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * Try to parse nginx's built-in "combined" format:
 *   $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent ...
 */
function parseCombinedLine(raw: string): LogEntry | null {
  // Basic combined regex — tolerant of extra trailing fields
  const m = raw.match(
    /^(\S+)\s+-\s+\S+\s+\[([^\]]+)\]\s+"(\w+)\s+(\S+)\s+[^"]*"\s+(\d+)\s+(\d+)/
  );
  if (!m) return null;
  const [, addr, timeStr, method, uri, status, bytes] = m;
  // parse "01/Jan/2025:12:00:00 +0000"
  const ts = new Date(timeStr.replace(
    /(\d+)\/(\w+)\/(\d+):(\d+:\d+:\d+)\s+([+-]\d{4})/,
    '$2 $1 $3 $4 $5'
  ));
  return {
    ts: isNaN(ts.getTime()) ? new Date() : ts,
    method,
    uri,
    status: Number(status),
    bytes: Number(bytes),
    remoteAddr: addr,
  };
}

function parseLine(raw: string): LogEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return parseJsonLine(trimmed);
  return parseCombinedLine(trimmed);
}

// ─── Ring buffer ───────────────────────────────────────────────────────────

// Keep 24 hours of log entries. We parse timestamps from the log lines so old
// entries don't vanish just because the dashboard was opened recently.
const WINDOW_SECONDS = 86_400;
const MAX_ENTRIES = 10_000;

function trimWindow(entries: LogEntry[]): LogEntry[] {
  const cutoff = Date.now() - WINDOW_SECONDS * 1000;
  const trimmed = entries.filter((e) => e.ts.getTime() >= cutoff);
  // Also cap absolute count to bound memory
  return trimmed.length > MAX_ENTRIES ? trimmed.slice(-MAX_ENTRIES) : trimmed;
}

function computeWindow(entries: LogEntry[]): Omit<LogWindow, 'logPath'> {
  if (entries.length === 0) {
    return {
      entries: [],
      reqPerSec: 0,
      statusDist: { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
      hasData: false,
    };
  }

  const now = Date.now();
  const lastMinEntries = entries.filter((e) => now - e.ts.getTime() < 60_000);

  const reqPerSec = lastMinEntries.length > 0
    ? Math.round((lastMinEntries.length / 60) * 10) / 10
    : 0;

  const dist = { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  for (const e of entries) {
    if (e.status >= 200 && e.status < 300) dist.s2xx++;
    else if (e.status >= 300 && e.status < 400) dist.s3xx++;
    else if (e.status >= 400 && e.status < 500) dist.s4xx++;
    else if (e.status >= 500) dist.s5xx++;
  }

  const withRt = entries.filter((e) => e.responseTime !== undefined);
  let p50ms: number | undefined;
  let p95ms: number | undefined;
  if (withRt.length > 0) {
    const sorted = [...withRt].sort((a, b) => (a.responseTime! - b.responseTime!));
    p50ms = Math.round(sorted[Math.floor(sorted.length * 0.5)]!.responseTime! * 1000);
    p95ms = Math.round(sorted[Math.floor(sorted.length * 0.95)]!.responseTime! * 1000);
  }

  const noResponseTime = withRt.length === 0;

  return {
    entries,
    reqPerSec,
    statusDist: dist,
    p50ms,
    p95ms,
    hasData: true,
    noResponseTime,
  };
}

// ─── Tailer ────────────────────────────────────────────────────────────────

/**
 * Polls a log file (local or remote via SSH) for new lines.
 * Call `poll()` on a timer; `getWindow()` returns the current computed stats.
 * Intentionally simple — no inotify/chokidar dependency. Portable on Windows
 * for local files; SSH path works on any OS since it's just text over a socket.
 *
 * `sshProvider` is a getter so the tailer always uses the current connection —
 * the shared SSH connection can be replaced on reconnect without invalidating
 * existing tailer instances.
 */
export class NginxLogTailer {
  private entries: LogEntry[] = [];
  private localOffset = 0;       // bytes consumed on last local read
  private lastError: string | undefined;
  private readonly sshProvider: (() => SshConnection | undefined) | undefined;

  constructor(
    private readonly logPath: string,
    ssh?: SshConnection | (() => SshConnection | undefined),
    /** Optional: override the default log path derivation for a custom location */
    private readonly remoteLogPath?: string,
  ) {
    if (typeof ssh === 'function') {
      this.sshProvider = ssh;
    } else if (ssh) {
      this.sshProvider = () => ssh;
    }
  }

  private get ssh(): SshConnection | undefined {
    return this.sshProvider?.();
  }

  /** Derive a per-route Nginx access log path from a domain name and route path.
   *  e.g. domain="api.example.com", routePath="/v1" → "/var/log/nginx/api_example_com_v1.access.log"
   *       domain="api.example.com", routePath="/"   → "/var/log/nginx/api_example_com_root.access.log"
   */
  static accessLogPath(domainName: string, routePath: string, isRemote = false): string {
    const safeDomain = domainName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    // Normalise route: strip leading/trailing slashes, replace separators with _
    const safeRoute = routePath.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]/gi, '_') || 'root';
    const dir = '/var/log/nginx';
    void isRemote; // path is the same whether local or remote SSH
    return `${dir}/${safeDomain}_${safeRoute}.access.log`;
  }

  async poll(): Promise<void> {
    if (this.ssh && this.ssh.isConnected) {
      await this.pollRemote();
    } else if (!this.ssh) {
      this.pollLocal();
    }
    // If ssh exists but not connected, skip this tick — pollRemote handles the error message
    this.entries = trimWindow(this.entries);
  }

  private pollLocal(): void {
    try {
      if (!fs.existsSync(this.logPath)) {
        this.lastError = `Log file not found: ${this.logPath}`;
        return;
      }
      const stat = fs.statSync(this.logPath);
      const size = stat.size;
      if (size < this.localOffset) {
        // Log was rotated — reset offset
        this.localOffset = 0;
      }
      if (size === this.localOffset) return; // no new data

      const fd = fs.openSync(this.logPath, 'r');
      try {
        const toRead = Math.min(size - this.localOffset, 256 * 1024); // max 256KB per poll
        const buf = Buffer.alloc(toRead);
        const bytesRead = fs.readSync(fd, buf, 0, toRead, this.localOffset);
        this.localOffset += bytesRead;
        const text = buf.subarray(0, bytesRead).toString('utf8');
        this.ingestText(text);
        this.lastError = undefined;
      } finally {
        fs.closeSync(fd);
      }
    } catch (err: any) {
      this.lastError = err.message;
    }
  }

  private async pollRemote(): Promise<void> {
    const path = this.remoteLogPath ?? this.logPath;
    const sshConn = this.ssh;
    if (!sshConn || !sshConn.isConnected) {
      this.lastError = 'Remote log read failed: SSH not connected';
      return;
    }
    try {
      let chunk: string;
      const MAX_READ = 256 * 1024;

      if (this.localOffset === 0) {
        // Initial seed: read last 2000 lines then get file size
        chunk = await sshConn.execWithSudoFallback(`tail -n 2000 "${path}" 2>/dev/null || true`);
        const sizeStr = await sshConn.execWithSudoFallback(`wc -c < "${path}" 2>/dev/null || echo 0`);
        this.localOffset = parseInt(sizeStr.trim(), 10) || 0;
      } else {
        // Get current file size
        const sizeStr = await sshConn.execWithSudoFallback(`wc -c < "${path}" 2>/dev/null || echo 0`);
        const newSize = parseInt(sizeStr.trim(), 10) || 0;

        if (newSize < this.localOffset) {
          // Log rotated — reset and re-seed next tick
          this.localOffset = 0;
          return;
        }
        if (newSize <= this.localOffset) return; // no new bytes

        // Read only the new bytes
        chunk = await sshConn.execWithSudoFallback(
          `tail -c +$((${this.localOffset} + 1)) "${path}" 2>/dev/null | head -c ${MAX_READ} || true`
        );
        this.localOffset = newSize;
      }

      this.ingestText(chunk);
      this.lastError = undefined;
    } catch (err: any) {
      this.lastError = `Remote log read failed: ${err.message}`;
    }
  }

  private ingestText(text: string): void {
    const lines = text.split('\n');
    for (const line of lines) {
      const entry = parseLine(line);
      if (entry) this.entries.push(entry);
    }
  }

  getWindow(): LogWindow {
    const w = computeWindow(this.entries);
    if (this.lastError) w.error = this.lastError;
    return { ...w, logPath: this.logPath };
  }

  reset(): void {
    this.entries = [];
    this.localOffset = 0;
    this.lastError = undefined;
  }
}
