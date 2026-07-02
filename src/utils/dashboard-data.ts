/**
 * dashboard-data.ts
 * Aggregates all data sources for the TUI dashboard.
 * Pure data layer — no Ink/React imports.
 */
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { AppRepo, DomainRepo, RouteRepo } from '../db/repos.js';
import { parseCertMetadata, CERT_EXPIRY_WARNING_DAYS } from './ssl-helper.js';
import { SshConnection } from './ssh-connection.js';
import { NginxLogTailer, LogWindow } from './nginx-log-tailer.js';
import { getVcsDriftInfo, VcsDriftInfo } from './vcs-helper.js';
import { calculateFileHash } from './file-utils.js';
import { listAllProcessMetrics, ProcessMetrics } from './pm2-helper.js';
import type { App, Domain, RouteWithAppAndDomain } from '../db/model.js';
import {
  NGINX_REMOTE_HOST,
  NGINX_REMOTE_KEY,
  NGINX_REMOTE_PASSWORD,
  NGINX_SUDO_PASSWORD,
  LOCK_DIR,
} from '../constants.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export type Pm2Status =
  | 'online' | 'stopped' | 'errored' | 'launching' | 'stopping' | 'not-found' | string;

/** Re-exported from pm2-helper so callers only need to import from dashboard-data */
export type { ProcessMetrics as Pm2Metrics, VcsDriftInfo };

export interface CertInfo {
  mode: 'none' | 'letsencrypt' | 'custom';
  expiresAt?: string;
  daysRemaining?: number;
  issuedTo?: string;
  issuer?: string;
  sanDomains?: string[];
  isExpired?: boolean;
  expiringSoon?: boolean;
  error?: string;
}

export interface DomainInfo {
  name: string;
  cert: CertInfo;
  routes: Array<{ path: string; appName: string; nginxLog?: LogWindow }>;
  lastPushedAt?: Date;
  lastCompiledAt?: Date;
  configPath?: string;
  /** True when compiled but never pushed, or recompiled since last push */
  isStale: boolean;
}

export interface AppData {
  app: App;
  pm2: ProcessMetrics | null;
  pm2Error?: string;
  portReachable?: boolean;
  drift: VcsDriftInfo | null;
  domains: DomainInfo[];
  isLocked: boolean;
  /** Restart delta since dashboard was opened */
  restartDelta: number;
  health: 'healthy' | 'degraded' | 'down' | 'unknown';
  /** env file changed since last deploy */
  envChanged?: boolean;
}

// ─── Port reachability ────────────────────────────────────────────────────────

function checkPortReachable(port: number, host = '127.0.0.1', timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => finish(true));
    sock.on('error', () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

// ─── SSL / cert info ──────────────────────────────────────────────────────────

function buildCertInfo(domain: Domain): CertInfo {
  const { ssl } = domain;
  if (ssl.mode === 'none') return { mode: 'none' };
  if (ssl.mode === 'letsencrypt') {
    // Metadata may be stored on the domain row if we ever parse it there
    return { mode: 'letsencrypt', expiresAt: ssl.expiresAt };
  }
  // custom — cert metadata is stored on Domain.ssl by ssl-helper after upload
  if (!ssl.certPath || !fs.existsSync(ssl.certPath)) {
    return { mode: 'custom', error: 'cert file missing' };
  }
  try {
    const pem = fs.readFileSync(ssl.certPath, 'utf8');
    const meta = parseCertMetadata(pem);
    const daysRemaining = Math.ceil(
      (new Date(meta.expiresAt).getTime() - Date.now()) / 86_400_000
    );
    return {
      mode: 'custom',
      expiresAt: meta.expiresAt,
      daysRemaining,
      issuedTo: meta.issuedTo,
      issuer: meta.issuer,
      sanDomains: meta.sanDomains,
      isExpired: daysRemaining <= 0,
      expiringSoon: daysRemaining > 0 && daysRemaining <= CERT_EXPIRY_WARNING_DAYS,
    };
  } catch (err: any) {
    return { mode: 'custom', error: err.message };
  }
}

// ─── Domain staleness (mirrors domain.ts domainList logic) ───────────────────

function isDomainStale(domain: Domain): boolean {
  if (!domain.lastPushedAt) return !!domain.lastCompiledAt; // compiled but never pushed
  if (domain.lastCompiledAt && new Date(domain.lastCompiledAt) > new Date(domain.lastPushedAt)) {
    return true; // recompiled since last push
  }
  return false;
}

// ─── Lock check ───────────────────────────────────────────────────────────────

function isLocked(appName: string): boolean {
  return fs.existsSync(path.join(LOCK_DIR, `${appName}.lock`));
}

// ─── Health derivation ────────────────────────────────────────────────────────

function deriveHealth(
  pm2Data: ProcessMetrics | null,
  portReachable: boolean | undefined,
  restartDelta: number,
  nginxWindows: LogWindow[],
): AppData['health'] {
  if (!pm2Data) return 'unknown';
  if (pm2Data.status === 'errored') return 'down';
  if (pm2Data.status === 'stopped' || pm2Data.status === 'not-found') return 'down';
  if (pm2Data.status === 'online') {
    const has5xx = nginxWindows.some((w) => {
      const total = w.statusDist.s2xx + w.statusDist.s3xx + w.statusDist.s4xx + w.statusDist.s5xx;
      return total > 10 && w.statusDist.s5xx / total > 0.1;
    });
    if (restartDelta > 0 || portReachable === false || has5xx) return 'degraded';
    return 'healthy';
  }
  return 'unknown';
}

// ─── SSH connection (shared, lazy) ────────────────────────────────────────────

let _sharedSsh: SshConnection | null = null;

async function getSharedSsh(): Promise<SshConnection | null> {
  if (!NGINX_REMOTE_HOST) return null;
  if (_sharedSsh) {
    try {
      await (_sharedSsh as any).exec('true');
      return _sharedSsh;
    } catch {
      _sharedSsh = null;
    }
  }
  try {
    const conn = new SshConnection({
      remoteHost: NGINX_REMOTE_HOST,
      sshKeyPath: NGINX_REMOTE_KEY,
      sshPassword: NGINX_REMOTE_PASSWORD,
      sudoPassword: NGINX_SUDO_PASSWORD,
    });
    await conn.connect();
    _sharedSsh = conn;
    return _sharedSsh;
  } catch {
    return null;
  }
}

export function disconnectSharedSsh(): void {
  if (_sharedSsh) {
    _sharedSsh.disconnect();
    _sharedSsh = null;
  }
}

// ─── Log tailer registry ──────────────────────────────────────────────────────

const tailerCache = new Map<string, NginxLogTailer>();

/**
 * Get or create a tailer for a domain that has been pushed to Nginx.
 * The log path is derived from the domain's configPath (same naming convention
 * as constructSitesAvailablePath in domain-push-utils.ts), replacing
 * sites-available with /var/log/nginx and .conf with .access.log.
 * Falls back to NginxLogTailer.accessLogPath() if configPath is unavailable.
 */
function getTailer(domain: Domain, routePath: string, isRemote: boolean): NginxLogTailer {
  const safeRoute = routePath.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '') || 'root';
  const key = `${domain.name}:${safeRoute}:${isRemote ? 'remote' : 'local'}`;
  if (tailerCache.has(key)) return tailerCache.get(key)!;

  const logPath = NginxLogTailer.accessLogPath(domain.name, routePath, isRemote);
  // Pass a getter so the tailer always uses the current shared connection,
  // even after a reconnect replaces the SshConnection instance.
  const sshProvider = isRemote ? () => _sharedSsh ?? undefined : undefined;
  const tailer = new NginxLogTailer(logPath, sshProvider);
  tailerCache.set(key, tailer);
  return tailer;
}

export function resetTailers(): void {
  tailerCache.forEach((t) => t.reset());
  tailerCache.clear();
}

// ─── Env-changed detection ────────────────────────────────────────────────────

function checkEnvChanged(app: App): boolean | undefined {
  try {
    const envFile = app.projectType === 'nextjs' ? '.env.local' : '.env';
    const srcEnv = path.join(app.appDir, 'env', envFile);
    const buildEnv = app.activeBuild ? path.join(app.activeBuild, envFile) : null;
    if (!buildEnv || !fs.existsSync(srcEnv) || !fs.existsSync(buildEnv)) return undefined;
    return calculateFileHash(srcEnv) !== calculateFileHash(buildEnv);
  } catch {
    return undefined;
  }
}

// ─── Restart baseline (per-session) ──────────────────────────────────────────

const restartBaseline = new Map<string, number>();

// ─── Main data types ──────────────────────────────────────────────────────────

export interface DashboardState {
  apps: AppData[];
  pm2Reachable: boolean;
  dbReachable: boolean;
  sshReachable: boolean;
  sshHost?: string;
  /** null on Windows (os.loadavg returns [0,0,0] which is misleading) */
  loadavg: [number, number, number] | null;
  totalMemBytes: number;
  freeMemBytes: number;
  tickCount: number;
}

/**
 * Full dashboard refresh.
 * @param doGitFetch  run git fetch this tick (slow; every ~60 s)
 * @param doLogPoll   poll Nginx log files this tick (every ~10 s)
 */
export async function refreshDashboard(
  prevState: DashboardState | null,
  doGitFetch: boolean,
  doLogPoll: boolean,
): Promise<DashboardState> {
  const tickCount = (prevState?.tickCount ?? 0) + 1;

  // ── DB ────────────────────────────────────────────────────────────────────
  let apps: App[] = [];
  let dbReachable = true;
  try {
    apps = await AppRepo.getAll();
  } catch {
    dbReachable = false;
    return {
      apps: prevState?.apps ?? [],
      pm2Reachable: prevState?.pm2Reachable ?? false,
      dbReachable: false,
      sshReachable: prevState?.sshReachable ?? false,
      sshHost: NGINX_REMOTE_HOST,
      loadavg: prevState?.loadavg ?? null,
      totalMemBytes: prevState?.totalMemBytes ?? 0,
      freeMemBytes: prevState?.freeMemBytes ?? 0,
      tickCount,
    };
  }

  // ── PM2 ───────────────────────────────────────────────────────────────────
  let pm2Metrics: ProcessMetrics[] = [];
  let pm2Reachable = true;
  try {
    pm2Metrics = await listAllProcessMetrics();
  } catch {
    pm2Reachable = false;
  }

  // Index by name for O(1) lookup per app
  const pm2ByName = new Map<string, ProcessMetrics>();
  for (const m of pm2Metrics) {
    pm2ByName.set(m.name, m);
  }

  // ── SSH (for remote Nginx log tailing) ────────────────────────────────────
  const ssh = await getSharedSsh();
  const sshReachable = !!ssh;

  // ── OS metrics ────────────────────────────────────────────────────────────
  // loadavg is Linux/macOS only — Windows always returns [0,0,0], which is
  // meaningless, so we hide it there rather than showing misleading zeros.
  const loadavg = os.platform() === 'win32'
    ? null
    : (os.loadavg() as [number, number, number]);
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();

  // ── Per-app data ───────────────────────────────────────────────────────────
  const appDataList: AppData[] = await Promise.all(
    apps.map(async (app): Promise<AppData> => {

      // PM2 — look up via listAllProcessMetrics result
      const pm2Data: ProcessMetrics | null = pm2Reachable
        ? (pm2ByName.get(app.name) ?? {
            name: app.name,
            status: 'not-found', cpu: 0, memBytes: 0, uptimeMs: 0,
            restarts: 0, unstableRestarts: 0, execMode: 'fork', instances: 1,
          })
        : null;
      const pm2Error = pm2Reachable ? undefined : 'PM2 unreachable';

      // Restart delta
      const currentRestarts = pm2Data?.restarts ?? 0;
      if (!restartBaseline.has(app.name)) restartBaseline.set(app.name, currentRestarts);
      const restartDelta = Math.max(0, currentRestarts - restartBaseline.get(app.name)!);

      // Port reachability
      let portReachable: boolean | undefined;
      if (pm2Data?.status === 'online' || !pm2Data) {
        portReachable = await checkPortReachable(app.port).catch(() => false);
      }

      // VCS drift — uses vcs-helper, handles both git and SVN
      const relDir = path.join(app.appDir, 'release');
      const drift = await getVcsDriftInfo(app, relDir, doGitFetch).catch((): VcsDriftInfo => ({
        branch: app.branch, behind: 0, ahead: 0, hasLocalChanges: false, fetched: false,
      }));

      // Domains for this app
      let routes: RouteWithAppAndDomain[] = [];
      try {
        routes = await RouteRepo.getAllByAppIdWithAppAndDomain(app.id);
      } catch { /* tolerate */ }

      // Deduplicate domains and build DomainInfo list
      const seenDomains = new Set<string>();
      const domainInfoList: DomainInfo[] = [];

      for (const route of routes) {
        const domainName = route.domain.name;
        if (seenDomains.has(domainName)) continue;
        seenDomains.add(domainName);

        // Re-fetch the domain row to get the latest push/compile timestamps
        let domain: Domain = route.domain;
        try {
          domain = await DomainRepo.findByName(domainName);
        } catch { /* use what we have from the route join */ }

        const cert = buildCertInfo(domain);
        const isStale = isDomainStale(domain);

        const domainRoutes = await Promise.all(
          routes
            .filter((r) => r.domain.name === domainName)
            .map(async (r) => {
              const routePath = r.path === '' ? '/' : r.path;
              let nginxLog: LogWindow | undefined;
              if (domain.lastPushedAt) {
                const tailer = getTailer(domain, routePath, !!ssh);
                if (doLogPoll) {
                  await tailer.poll().catch(() => { /* tolerate read errors */ });
                }
                nginxLog = tailer.getWindow();
              }
              return { path: routePath, appName: r.app.name, nginxLog };
            })
        );

        // Only attach a log tailer when the domain has actually been pushed to Nginx.
        // If lastPushedAt is not set, there's no Nginx serving this domain — no log to read.

        domainInfoList.push({
          name: domainName,
          cert,
          routes: domainRoutes,
          lastPushedAt: domain.lastPushedAt,
          lastCompiledAt: domain.lastCompiledAt,
          configPath: domain.configPath ?? undefined,
          isStale,
        });
      }

      // Env-changed detection (read-only, reuses calculateFileHash from file-utils)
      const envChanged = checkEnvChanged(app);

      const nginxWindows = domainInfoList
        .flatMap((d) => d.routes)
        .filter((r) => r.nginxLog?.hasData)
        .map((r) => r.nginxLog!);

      const health = deriveHealth(pm2Data, portReachable, restartDelta, nginxWindows);

      return {
        app,
        pm2: pm2Data,
        pm2Error,
        portReachable,
        drift,
        domains: domainInfoList,
        isLocked: isLocked(app.name),
        restartDelta,
        health,
        envChanged,
      };
    })
  );

  return {
    apps: appDataList,
    pm2Reachable,
    dbReachable,
    sshReachable,
    sshHost: NGINX_REMOTE_HOST,
    loadavg,
    totalMemBytes,
    freeMemBytes,
    tickCount,
  };
}
