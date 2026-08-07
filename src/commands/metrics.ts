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

const POLL_INTERVAL_MS = 500;

async function getSshConnection(): Promise<SshConnection | undefined> {
  if (!NGINX_REMOTE_HOST) return undefined;
  const conn = new SshConnection({
    remoteHost: NGINX_REMOTE_HOST,
    sshKeyPath: NGINX_REMOTE_KEY,
    sshPassword: NGINX_REMOTE_PASSWORD,
    sudoPassword: NGINX_SUDO_PASSWORD,
  });
  await conn.connect();
  return conn;
}

export const metrics = async ({ name }: { name: string }) => {
  const app = await AppRepo.findByName(name);
  const routes = await RouteRepo.getAllByAppIdWithAppAndDomain(app.id);

  if (routes.length === 0) {
    Logger.error(`No routes found for "${name}". Add a domain route first.`);
    process.exit(1);
  }

  const isRemote = !!NGINX_REMOTE_HOST;
  let ssh: SshConnection | undefined;

  if (isRemote) {
    try {
      ssh = await getSshConnection();
    } catch (err: any) {
      Logger.error(`Failed to connect to remote SSH (${NGINX_REMOTE_HOST}): ${err.message}`);
      process.exit(1);
    }
  }

  // Build one tailer per unique log file
  const tailers: Array<{ label: string; tailer: NginxLogTailer }> = [];
  const seen = new Set<string>();

  for (const route of routes) {
    const routePath = route.path === '' ? '/' : route.path;
    const logPath = NginxLogTailer.accessLogPath(route.domain.name, routePath, isRemote);
    if (seen.has(logPath)) continue;
    seen.add(logPath);

    const tailer = ssh
      ? new NginxLogTailer(logPath, ssh)
      : new NginxLogTailer(logPath);

    tailers.push({ label: `${route.domain.name}${routePath}`, tailer });
  }

  Logger.info(
    `Streaming nginx logs for "${Logger.highlight(name)}"${isRemote ? ` via ${NGINX_REMOTE_HOST}` : ''} (Ctrl+C to stop)...\n`
  );

  // Seed historical entries
  for (const { label, tailer } of tailers) {
    await tailer.poll();
    const window = tailer.getWindow();
    if (window.error) {
      Logger.warn(`[${label}] ${window.error}`);
    }
    for (const entry of window.recentEntries) {
      printEntry(entry, tailers.length > 1 ? label : undefined);
    }
  }

  const lastCounts = new Map(
    tailers.map(({ label, tailer }) => [label, tailer.getWindow().recentEntries.length])
  );

  const cleanup = () => {
    clearInterval(timer);
    ssh?.disconnect?.();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const timer = setInterval(async () => {
    for (const { label, tailer } of tailers) {
      await tailer.poll();
      const window = tailer.getWindow();
      const entries = window.recentEntries;
      const prev = lastCounts.get(label) ?? 0;
      if (entries.length > prev) {
        for (const entry of entries.slice(prev)) {
          printEntry(entry, tailers.length > 1 ? label : undefined);
        }
        lastCounts.set(label, entries.length);
      } else if (entries.length < prev) {
        lastCounts.set(label, entries.length);
      }
    }
  }, POLL_INTERVAL_MS);
};

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
