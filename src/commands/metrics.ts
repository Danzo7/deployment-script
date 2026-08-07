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

  // Filter out routes whose domain has never been pushed to nginx
  const unpushedDomains = [...new Set(
    routes.filter((r) => !r.domain.lastPushedAt).map((r) => r.domain.name)
  )];
  if (unpushedDomains.length > 0) {
    for (const d of unpushedDomains) {
      Logger.warn(`Domain "${d}" has never been pushed to Nginx — skipping (run: dm domain push ${d})`);
    }
  }

  const pushedRoutes = routes.filter((r) => r.domain.lastPushedAt);
  if (pushedRoutes.length === 0) {
    Logger.error('No pushed domains found for this app. Run dm domain push <domain> first.');
    ssh?.disconnect?.();
    process.exit(1);
  }

  // Build one tailer per unique log file
  const tailers: Array<{ label: string; tailer: NginxLogTailer }> = [];
  const seen = new Set<string>();

  for (const route of pushedRoutes) {
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

  // Track the timestamp of the last printed entry per tailer so new entries
  // are detected by timestamp rather than array index (which can shift when
  // trimWindow evicts old entries).
  const lastSeenTs = new Map<string, number>();

  for (const { label, tailer } of tailers) {
    await tailer.poll();
    const window = tailer.getWindow();
    if (window.error) {
      Logger.warn(`[${label}] ${window.error}`);
    }
    for (const entry of window.recentEntries) {
      printEntry(entry, tailers.length > 1 ? label : undefined);
    }
    const last = window.recentEntries.at(-1);
    lastSeenTs.set(label, last ? last.ts.getTime() : Date.now());
  }

  const cleanup = () => {
    stopped = true;
    ssh?.disconnect?.();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    for (const { label, tailer } of tailers) {
      await tailer.poll();
      const window = tailer.getWindow();
      const prev = lastSeenTs.get(label) ?? 0;
      const newEntries = window.entries.filter((e) => e.ts.getTime() > prev);
      if (newEntries.length > 0) {
        for (const entry of newEntries) {
          printEntry(entry, tailers.length > 1 ? label : undefined);
        }
        lastSeenTs.set(label, newEntries.at(-1)!.ts.getTime());
      }
    }
    if (!stopped) setTimeout(poll, POLL_INTERVAL_MS);
  };

  setTimeout(poll, POLL_INTERVAL_MS);
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
