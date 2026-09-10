import fs from "fs";
function parseJsonLine(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o.status) return null;
    return {
      ts: new Date(o.ts ?? Date.now()),
      method: o.method ?? "-",
      uri: o.uri ?? "/",
      status: Number(o.status),
      bytes: Number(o.bytes ?? 0),
      responseTime: o.rt !== void 0 && o.rt !== "-" ? Number(o.rt) : void 0,
      remoteAddr: o.addr ?? ""
    };
  } catch {
    return null;
  }
}
function parseCombinedLine(raw) {
  const m = raw.match(
    /^(\S+)\s+-\s+\S+\s+\[([^\]]+)\]\s+"(\w+)\s+(\S+)\s+[^"]*"\s+(\d+)\s+(\d+)/
  );
  if (!m) return null;
  const [, addr, timeStr, method, uri, status, bytes] = m;
  const ts = new Date(
    timeStr.replace(
      /(\d+)\/(\w+)\/(\d+):(\d+:\d+:\d+)\s+([+-]\d{4})/,
      "$2 $1 $3 $4 $5"
    )
  );
  return {
    ts: isNaN(ts.getTime()) ? /* @__PURE__ */ new Date() : ts,
    method,
    uri,
    status: Number(status),
    bytes: Number(bytes),
    remoteAddr: addr
  };
}
function parseLine(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return parseJsonLine(trimmed);
  return parseCombinedLine(trimmed);
}
const WINDOW_SECONDS = 86400;
const MAX_ENTRIES = 1e4;
function trimWindow(entries) {
  const cutoff = Date.now() - WINDOW_SECONDS * 1e3;
  const trimmed = entries.filter((e) => e.ts.getTime() >= cutoff);
  return trimmed.length > MAX_ENTRIES ? trimmed.slice(-MAX_ENTRIES) : trimmed;
}
function computeWindow(entries) {
  if (entries.length === 0) {
    return {
      entries: [],
      reqPerSec: 0,
      statusDist: { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
      hasData: false,
      recentEntries: []
    };
  }
  const now = Date.now();
  const lastMinEntries = entries.filter((e) => now - e.ts.getTime() < 6e4);
  const reqPerSec = lastMinEntries.length > 0 ? Math.round(lastMinEntries.length / 60 * 10) / 10 : 0;
  const dist = { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  for (const e of entries) {
    if (e.status >= 200 && e.status < 300) dist.s2xx++;
    else if (e.status >= 300 && e.status < 400) dist.s3xx++;
    else if (e.status >= 400 && e.status < 500) dist.s4xx++;
    else if (e.status >= 500) dist.s5xx++;
  }
  const withRt = entries.filter((e) => e.responseTime !== void 0);
  let p50ms;
  let p95ms;
  if (withRt.length > 0) {
    const sorted = [...withRt].sort(
      (a, b) => a.responseTime - b.responseTime
    );
    p50ms = Math.round(
      sorted[Math.floor(sorted.length * 0.5)].responseTime * 1e3
    );
    p95ms = Math.round(
      sorted[Math.floor(sorted.length * 0.95)].responseTime * 1e3
    );
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
    recentEntries: entries.slice(-200)
  };
}
class NginxLogTailer {
  constructor(logPath, ssh, remoteLogPath) {
    this.logPath = logPath;
    this.remoteLogPath = remoteLogPath;
    this.entries = [];
    this.localOffset = 0;
    /** True once the file has been successfully accessed at least once (no "not found" error) */
    this.hasPolled = false;
    if (typeof ssh === "function") {
      this.sshProvider = ssh;
    } else if (ssh) {
      this.sshProvider = () => ssh;
    }
  }
  get ssh() {
    return this.sshProvider?.();
  }
  /** Derive a per-route Nginx access log path from a domain name and route path.
   *  e.g. domain="api.example.com", routePath="/v1" → "/var/log/nginx/api_example_com_v1.access.log"
   *       domain="api.example.com", routePath="/"   → "/var/log/nginx/api_example_com_root.access.log"
   */
  static accessLogPath(domainName, routePath, isRemote = false) {
    const safeDomain = domainName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const safeRoute = routePath.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]/gi, "_") || "root";
    const dir = "/var/log/nginx";
    return `${dir}/${safeDomain}_${safeRoute}.access.log`;
  }
  async poll(signal) {
    if (signal?.aborted) return;
    if (this.ssh && this.ssh.isConnected) {
      await this.pollRemote(signal);
    } else if (!this.ssh) {
      this.pollLocal();
    }
    this.entries = trimWindow(this.entries);
  }
  pollLocal() {
    try {
      if (!fs.existsSync(this.logPath)) {
        this.lastError = `Log file not found: ${this.logPath}`;
        return;
      }
      const stat = fs.statSync(this.logPath);
      const size = stat.size;
      if (size < this.localOffset) {
        this.localOffset = 0;
      }
      if (size === this.localOffset) {
        this.lastError = void 0;
        this.hasPolled = true;
        return;
      }
      const fd = fs.openSync(this.logPath, "r");
      try {
        const toRead = Math.min(size - this.localOffset, 256 * 1024);
        const buf = Buffer.alloc(toRead);
        const bytesRead = fs.readSync(fd, buf, 0, toRead, this.localOffset);
        this.localOffset += bytesRead;
        const text = buf.subarray(0, bytesRead).toString("utf8");
        this.ingestText(text);
        this.lastError = void 0;
        this.hasPolled = true;
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      this.lastError = err.message;
    }
  }
  async pollRemote(signal) {
    const path = this.remoteLogPath ?? this.logPath;
    const sshConn = this.ssh;
    if (sshConn && !sshConn.isConnected) {
      this.lastError = void 0;
      this.hasPolled = true;
      return;
    }
    if (!sshConn) {
      this.lastError = void 0;
      this.hasPolled = true;
      return;
    }
    if (signal?.aborted) {
      this.hasPolled = true;
      return;
    }
    try {
      const MAX_READ = 256 * 1024;
      const result = await this.remoteReadChunk(
        sshConn,
        path,
        this.localOffset,
        MAX_READ,
        signal
      );
      if (signal?.aborted) {
        this.hasPolled = true;
        return;
      }
      if (result === null) {
        this.lastError = `Log file not found: ${path}`;
        this.hasPolled = true;
        return;
      }
      const { size, chunk } = result;
      if (size < this.localOffset) {
        this.localOffset = 0;
        this.hasPolled = true;
        return;
      }
      if (this.localOffset === 0) {
        this.localOffset = size;
      } else {
        this.localOffset = size;
      }
      if (chunk.length > 0) {
        this.ingestText(chunk.toString("utf8"));
      }
      this.lastError = void 0;
      this.hasPolled = true;
    } catch (err) {
      if (signal?.aborted) {
        this.hasPolled = true;
        return;
      }
      this.lastError = `Remote log read failed: ${err.message}`;
      this.hasPolled = true;
    }
  }
  /** Read a chunk of a remote file via SFTP, falling back to sudo cat if permission denied. */
  async remoteReadChunk(sshConn, path, offset, maxBytes, signal) {
    if (signal?.aborted) return null;
    try {
      if (offset === 0) {
        const stat = await sshConn.sftpReadChunk(path, 0, 0, signal);
        if (signal?.aborted) return null;
        if (stat === null) return null;
        const seedOffset = Math.max(0, stat.size - maxBytes);
        return await sshConn.sftpReadChunk(path, seedOffset, maxBytes, signal);
      }
      return await sshConn.sftpReadChunk(path, offset, maxBytes, signal);
    } catch {
      if (signal?.aborted) return null;
      const text = await sshConn.execWithSudo(`cat "${path}"`, signal);
      if (signal?.aborted) return null;
      const buf = Buffer.from(text, "utf8");
      if (buf.length === 0) return null;
      const chunk = offset === 0 ? buf.subarray(Math.max(0, buf.length - maxBytes)) : buf.subarray(
        Math.min(offset, buf.length),
        Math.min(offset + maxBytes, buf.length)
      );
      return { size: buf.length, chunk };
    }
  }
  ingestText(text) {
    if (!this.lastRawSample && text.trim()) {
      this.lastRawSample = text.slice(0, 200);
    }
    const lines = text.split("\n");
    for (const line of lines) {
      const entry = parseLine(line);
      if (entry) this.entries.push(entry);
    }
  }
  getWindow() {
    const w = computeWindow(this.entries);
    if (!this.hasPolled) w.loading = true;
    if (this.lastError) w.error = this.lastError;
    if (!w.hasData) w.rawSample = this.lastRawSample;
    return { ...w, logPath: this.logPath };
  }
  reset() {
    this.entries = [];
    this.localOffset = 0;
    this.lastError = void 0;
    this.lastRawSample = void 0;
    this.hasPolled = false;
  }
}
export {
  NginxLogTailer
};
