import { AppRepo, RouteRepo, DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { NginxLogTailer } from '../utils/nginx-log-tailer.js';
import type { LogEntry } from '../utils/nginx-log-tailer.js';

const POLL_INTERVAL_MS = 500;

export const metrics = async ({ name }: { name: string }) => {
  const app = await AppRepo.findByName(name);

  // Find all routes for this app and resolve their log paths
  const routes = await RouteRepo.getAllByAppIdWithAppAndDomain(app.id);

  if (routes.length === 0) {
    Logger.error(`No routes found for "${name}". Add a domain route first.`);
    process.exit(1);
  }

  // Build one tailer per route log file (deduplicated by path)
  const tailers: Array<{ label: string; tailer: NginxLogTailer }> = [];
  const seen = new Set<string>();

  for (const route of routes) {
    const domain = await DomainRepo.findByName(route.domain.name);
    const logPath = NginxLogTailer.accessLogPath(domain.name, route.path);
    if (seen.has(logPath)) continue;
    seen.add(logPath);
    tailers.push({
      label: `${domain.name}${route.path}`,
      tailer: new NginxLogTailer(logPath),
    });
  }

  Logger.info(
    `Streaming nginx logs for "${Logger.highlight(name)}" (Ctrl+C to stop)...\n`
  );

  // Seed each tailer and print existing tail
  for (const { tailer } of tailers) {
    await tailer.poll();
    const window = tailer.getWindow();
    for (const entry of window.recentEntries) {
      printEntry(entry, tailers.length > 1 ? tailers.find(t => t.tailer === tailer)!.label : undefined);
    }
  }

  const lastCounts = new Map(tailers.map(({ label, tailer }) => [label, tailer.getWindow().recentEntries.length]));

  const sigintHandler = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigintHandler);

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
        // log rotated
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
