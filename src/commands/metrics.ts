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

// Shared connection reference — replaced on reconnect so tailer provider
// always hands the current live instance to each poll() call.
let _ssh: SshConnection | null = null;

async function getOrReconnectSsh(): Promise<SshConnection | null> {
  if (!NGINX_REMOTE_HOST) return null;
  if (_ssh?.isConnected) return _ssh;
  // Connection is dead or never established — (re)connect
  try {
    const conn = new SshConnection({
      remoteHost: NGINX_REMOTE_HOST,
      sshKeyPath: NGINX_REMOTE_KEY,
      sshPassword: NGINX_REMOTE_PASSWORD,
      sudoPassword: NGINX_SUDO_PASSWORD,
    });
    await conn.connect();
    _ssh = conn;
    return _ssh;
  } catch {
    _ssh = null;
    return null;
  }
}

export const metrics = async ({ name }: { name: string }) => {
  const app = await AppRepo.findByName(name);
  const routes = await RouteRepo.getAllByAppIdWithAppAndDomain(app.id);

  if (routes.length === 0) {
    Logger.error(`No routes found for "${name}". Add a domain route first.`);
    process.exit(1);
  }

  const isRemote = !!NGINX_REMOTE_HOST;

  if (isRemote) {
    try {
      const conn = await getOrReconnectSsh();
      if (!conn) throw new Error('connection returned null');
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
    _ssh?.disconnect?.();
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

    const tailer = isRemote
      ? new NginxLogTailer(logPath, () => _ssh ?? undefined)
      : new NginxLogTailer(logPath);

    tailers.push({ label: `${route.domain.name}${routePath}`, tailer });
  }

  Logger.info(
    `Streaming nginx logs for "${Logger.highlight(name)}"${isRemote ? ` via ${NGINX_REMOTE_HOST}` : ''} (Ctrl+C to stop)...\n`
  );

  // Seed: print the current recentEntries snapshot (last 200), same source
  // as the MetricsTab logs view. Track how many we've printed so on each
  // subsequent poll we only print the newly appended tail.
  const printedCount = new Map<string, number>();

  for (const { label, tailer } of tailers) {
    await tailer.poll();
    const window = tailer.getWindow();
    if (window.error) {
      Logger.warn(`[${label}] ${window.error}`);
    }
    for (const entry of window.recentEntries) {
      printEntry(entry, tailers.length > 1 ? label : undefined);
    }
    printedCount.set(label, window.recentEntries.length);
  }

  const cleanup = () => {
    stopped = true;
    _ssh?.disconnect?.();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    // Reconnect SSH if the connection dropped — tailers use a provider so they
    // pick up the fresh instance automatically on the next poll() call.
    if (isRemote) await getOrReconnectSsh();
    for (const { label, tailer } of tailers) {
      await tailer.poll();
      const window = tailer.getWindow();
      const recent = window.recentEntries;
      const prev = printedCount.get(label) ?? 0;

      if (recent.length > prev) {
        // New entries appended to the tail — print only the new ones
        for (const entry of recent.slice(prev)) {
          printEntry(entry, tailers.length > 1 ? label : undefined);
        }
        printedCount.set(label, recent.length);
      } else if (recent.length < prev) {
        // recentEntries slid (>200 total) or log rotated — print the full new tail
        for (const entry of recent) {
          printEntry(entry, tailers.length > 1 ? label : undefined);
        }
        printedCount.set(label, recent.length);
      }
      // recent.length === prev → nothing new
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
