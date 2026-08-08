import { spawn } from 'child_process';
import { AppRepo, RouteRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { NginxLogTailer } from '../utils/nginx-log-tailer.js';
import type { LogEntry } from '../utils/nginx-log-tailer.js';
import { SshConnection } from '../utils/ssh-connection.js';
import {
  NGINX_REMOTE_HOST,
  NGINX_REMOTE_KEY,
  NGINX_REMOTE_PASSWORD,
  NGINX_SUDO_PASSWORD,
} from '../constants.js';

// ─── Entry printer ────────────────────────────────────────────────────────────

function printEntry(entry: LogEntry, label?: string) {
  const status = entry.status;
  const statusStr =
    status >= 500
      ? `\x1b[31m${status}\x1b[0m`
      : status >= 400
        ? `\x1b[33m${status}\x1b[0m`
        : status >= 300
          ? `\x1b[36m${status}\x1b[0m`
          : `\x1b[32m${status}\x1b[0m`;

  const ts = entry.ts.toISOString().replace('T', ' ').slice(0, 19);
  const rt = entry.responseTime !== undefined ? ` ${Math.round(entry.responseTime * 1000)}ms` : '';
  const prefix = label ? `[${label}] ` : '';

  process.stdout.write(`${ts} ${prefix}${statusStr} ${entry.method} ${entry.uri}${rt} - ${entry.remoteAddr}\n`);
}

// ─── Line parser ──────────────────────────────────────────────────────────────

function handleLine(line: string, label?: string) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let entry: LogEntry | null = null;

  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed);
      if (o.status) {
        entry = {
          ts: new Date(o.ts ?? Date.now()),
          method: o.method ?? '-',
          uri: o.uri ?? '/',
          status: Number(o.status),
          bytes: Number(o.bytes ?? 0),
          responseTime: o.rt !== undefined && o.rt !== '-' ? Number(o.rt) : undefined,
          remoteAddr: o.addr ?? '',
        };
      }
    } catch { /* fall through */ }
  } else {
    const m = trimmed.match(
      /^(\S+)\s+-\s+\S+\s+\[([^\]]+)\]\s+"(\w+)\s+(\S+)\s+[^"]*"\s+(\d+)\s+(\d+)/
    );
    if (m) {
      const [, addr, timeStr, method, uri, status, bytes] = m;
      const ts = new Date(
        timeStr.replace(/(\d+)\/(\w+)\/(\d+):(\d+:\d+:\d+)\s+([+-]\d{4})/, '$2 $1 $3 $4 $5')
      );
      entry = {
        ts: isNaN(ts.getTime()) ? new Date() : ts,
        method,
        uri,
        status: Number(status),
        bytes: Number(bytes),
        remoteAddr: addr,
      };
    }
  }

  if (entry) {
    printEntry(entry, label);
  } else {
    process.stdout.write(`${trimmed}\n`);
  }
}

// ─── Local tail ───────────────────────────────────────────────────────────────

function tailLocal(logPath: string, label: string | undefined): () => void {
  const child = spawn('tail', ['-f', '-n', '50', logPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) handleLine(line, label);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    Logger.warn(`tail: ${chunk.toString().trim()}`);
  });

  child.on('error', (err) => Logger.error(`tail error: ${err.message}`));

  return () => child.kill();
}

// ─── Remote tail via SshConnection ───────────────────────────────────────────

async function tailRemote(
  logPath: string,
  label: string | undefined,
  onError: (err: Error) => void
): Promise<() => void> {
  const conn = new SshConnection({
    remoteHost: NGINX_REMOTE_HOST!,
    sshKeyPath: NGINX_REMOTE_KEY,
    sshPassword: NGINX_REMOTE_PASSWORD,
    sudoPassword: NGINX_SUDO_PASSWORD,
  });

  await conn.connect();

  const cmd = `tail -f -n 50 '${logPath}'`;

  const stop = conn.execStream(
    cmd,
    (line) => handleLine(line, label),
    onError
  );

  return stop;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const metrics = async ({ name }: { name: string }) => {
  const app = await AppRepo.findByName(name);
  const routes = await RouteRepo.getAllByAppIdWithAppAndDomain(app.id);

  if (routes.length === 0) {
    throw new Error(`No routes found for "${name}". Add a domain route first.`);
  }

  const isRemote = !!NGINX_REMOTE_HOST;

  const unpushedDomains = [...new Set(
    routes.filter((r) => !r.domain.lastPushedAt).map((r) => r.domain.name)
  )];
  for (const d of unpushedDomains) {
    Logger.warn(`Domain "${d}" has never been pushed to Nginx — skipping (run: dm domain push ${d})`);
  }

  const pushedRoutes = routes.filter((r) => r.domain.lastPushedAt);
  if (pushedRoutes.length === 0) {
    throw new Error('No pushed domains found for this app. Run dm domain push <domain> first.');
  }

  // Deduplicate by log file path
  const seen = new Set<string>();
  const targets: Array<{ logPath: string; label: string }> = [];
  for (const route of pushedRoutes) {
    const routePath = route.path === '' ? '/' : route.path;
    const logPath = NginxLogTailer.accessLogPath(route.domain.name, routePath, isRemote);
    if (seen.has(logPath)) continue;
    seen.add(logPath);
    targets.push({ logPath, label: `${route.domain.name}${routePath}` });
  }

  const multiLabel = targets.length > 1;

  Logger.info(
    `Streaming nginx logs for "${Logger.highlight(name)}"${isRemote ? ` via ${NGINX_REMOTE_HOST}` : ''} (Ctrl+C to stop)...\n`
  );

  const stopFns: Array<() => void> = [];

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);

    const start = async () => {
      for (const { logPath, label } of targets) {
        if (isRemote) {
          const stop = await tailRemote(logPath, multiLabel ? label : undefined, onError);
          stopFns.push(stop);
        } else {
          const stop = tailLocal(logPath, multiLabel ? label : undefined);
          stopFns.push(stop);
        }
      }
    };

    start().catch(reject);

    const cleanup = () => {
      for (const stop of stopFns) stop();
      resolve();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
};
