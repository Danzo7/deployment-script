import net from "net";
import os from "os";
import fs from "fs";
import path from "path";
import { AppRepo, AppConfigRepo, RouteRepo } from "../db/repos.js";
import { parseCertMetadata, CERT_EXPIRY_WARNING_DAYS } from "./ssl-helper.js";
import { SshConnection } from "./ssh-connection.js";
import { NginxLogTailer } from "./nginx-log-tailer.js";
import { getVcsDriftInfo } from "./vcs-helper.js";
import { calculateFileHash } from "./file-utils.js";
import { listAllProcessMetrics } from "./pm2-helper.js";
import {
  NGINX_REMOTE_HOST,
  NGINX_REMOTE_KEY,
  NGINX_REMOTE_PASSWORD,
  NGINX_SUDO_PASSWORD,
  LOCK_DIR
} from "../constants.js";
function checkPortReachable(port, host = "127.0.0.1", timeoutMs = 1e3) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => finish(true));
    sock.on("error", () => finish(false));
    sock.on("timeout", () => finish(false));
  });
}
function buildCertInfo(domain) {
  const { ssl } = domain;
  if (ssl.mode === "none") return { mode: "none" };
  if (ssl.mode === "letsencrypt")
    return { mode: "letsencrypt", expiresAt: ssl.expiresAt };
  if (!ssl.certPath || !fs.existsSync(ssl.certPath)) {
    return { mode: "custom", error: "cert file missing" };
  }
  try {
    const pem = fs.readFileSync(ssl.certPath, "utf8");
    const meta = parseCertMetadata(pem);
    const daysRemaining = Math.ceil(
      (new Date(meta.expiresAt).getTime() - Date.now()) / 864e5
    );
    return {
      mode: "custom",
      expiresAt: meta.expiresAt,
      daysRemaining,
      issuedTo: meta.issuedTo,
      issuer: meta.issuer,
      sanDomains: meta.sanDomains,
      isExpired: daysRemaining <= 0,
      expiringSoon: daysRemaining > 0 && daysRemaining <= CERT_EXPIRY_WARNING_DAYS
    };
  } catch (err) {
    return { mode: "custom", error: err.message };
  }
}
function isDomainStale(domain) {
  if (!domain.lastPushedAt) return !!domain.lastCompiledAt;
  if (domain.lastCompiledAt && new Date(domain.lastCompiledAt) > new Date(domain.lastPushedAt)) {
    return true;
  }
  return false;
}
function isLocked(appName) {
  return fs.existsSync(path.join(LOCK_DIR, `${appName}.lock`));
}
function deriveHealth(pm2Data, portReachable, restartDelta, nginxWindows) {
  if (!pm2Data) return "unknown";
  if (pm2Data.status === "errored") return "down";
  if (pm2Data.status === "stopped" || pm2Data.status === "not-found")
    return "down";
  if (pm2Data.status === "online") {
    const has5xx = nginxWindows.some((w) => {
      const total = w.statusDist.s2xx + w.statusDist.s3xx + w.statusDist.s4xx + w.statusDist.s5xx;
      return total > 10 && w.statusDist.s5xx / total > 0.1;
    });
    if (restartDelta > 0 || portReachable === false || has5xx)
      return "degraded";
    return "healthy";
  }
  return "unknown";
}
let _sharedSsh = null;
async function getSharedSsh() {
  if (!NGINX_REMOTE_HOST) return null;
  if (_sharedSsh) {
    if (!_sharedSsh.isConnected) {
      _sharedSsh = null;
    } else {
      return _sharedSsh;
    }
  }
  try {
    const conn = new SshConnection({
      remoteHost: NGINX_REMOTE_HOST,
      sshKeyPath: NGINX_REMOTE_KEY,
      sshPassword: NGINX_REMOTE_PASSWORD,
      sudoPassword: NGINX_SUDO_PASSWORD
    });
    await conn.connect();
    _sharedSsh = conn;
    return _sharedSsh;
  } catch {
    return null;
  }
}
function disconnectSharedSsh() {
  if (_sharedSsh) {
    _sharedSsh.disconnect();
    _sharedSsh = null;
  }
}
const tailerCache = /* @__PURE__ */ new Map();
function getTailer(domain, routePath, isRemote) {
  const safeRoute = routePath.replace(/[^a-z0-9]/gi, "_").replace(/^_+|_+$/g, "") || "root";
  const key = `${domain.name}:${safeRoute}:${isRemote ? "remote" : "local"}`;
  if (tailerCache.has(key)) return tailerCache.get(key);
  const logPath = NginxLogTailer.accessLogPath(
    domain.name,
    routePath,
    isRemote
  );
  const sshProvider = isRemote ? () => _sharedSsh ?? void 0 : void 0;
  const tailer = new NginxLogTailer(logPath, sshProvider);
  tailerCache.set(key, tailer);
  return tailer;
}
function resetTailers() {
  tailerCache.forEach((t) => t.reset());
  tailerCache.clear();
}
function checkEnvChanged(app) {
  try {
    const envFile = app.projectType === "nextjs" ? ".env.local" : ".env";
    const srcEnv = path.join(app.appDir, "env", envFile);
    const buildEnv = app.activeBuild ? path.join(app.activeBuild, envFile) : null;
    if (!buildEnv || !fs.existsSync(srcEnv) || !fs.existsSync(buildEnv))
      return void 0;
    return calculateFileHash(srcEnv) !== calculateFileHash(buildEnv);
  } catch {
    return void 0;
  }
}
const restartBaseline = /* @__PURE__ */ new Map();
async function listApps(prev) {
  const tickCount = (prev?.tickCount ?? 0) + 1;
  let apps = [];
  let dbReachable = true;
  try {
    apps = await AppRepo.getAll();
  } catch {
    dbReachable = false;
    return {
      summaries: prev?.summaries ?? [],
      pm2Reachable: prev?.pm2Reachable ?? false,
      dbReachable: false,
      sshReachable: prev?.sshReachable ?? false,
      sshHost: NGINX_REMOTE_HOST,
      loadavg: prev?.loadavg ?? null,
      totalMemBytes: prev?.totalMemBytes ?? 0,
      freeMemBytes: prev?.freeMemBytes ?? 0,
      tickCount
    };
  }
  let pm2Metrics = [];
  let pm2Reachable = true;
  try {
    pm2Metrics = await listAllProcessMetrics();
  } catch {
    pm2Reachable = false;
  }
  const pm2ByName = /* @__PURE__ */ new Map();
  for (const m of pm2Metrics) pm2ByName.set(m.name, m);
  const ssh = await getSharedSsh();
  const sshReachable = !!ssh;
  const loadavg = os.platform() === "win32" ? null : os.loadavg();
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const summaries = await Promise.all(apps.map(async (app) => {
    const pm2Data = pm2Reachable ? pm2ByName.get(app.name) ?? {
      name: app.name,
      status: "not-found",
      cpu: 0,
      memBytes: 0,
      uptimeMs: 0,
      restarts: 0,
      unstableRestarts: 0,
      execMode: "fork",
      instances: 1
    } : null;
    const currentRestarts = pm2Data?.restarts ?? 0;
    if (!restartBaseline.has(app.name))
      restartBaseline.set(app.name, currentRestarts);
    const restartDelta = Math.max(
      0,
      currentRestarts - restartBaseline.get(app.name)
    );
    let config = await AppConfigRepo.findByAppId(app.id);
    if (!config) {
      config = await AppConfigRepo.create({
        appId: app.id,
        instances: 1,
        maxMemory: "250M"
      });
    }
    const health = deriveHealth(pm2Data, void 0, restartDelta, []);
    return {
      app,
      config,
      pm2: pm2Data,
      pm2Error: pm2Reachable ? void 0 : "PM2 unreachable",
      restartDelta,
      isLocked: isLocked(app.name),
      health
    };
  }));
  return {
    summaries,
    pm2Reachable,
    dbReachable,
    sshReachable,
    sshHost: NGINX_REMOTE_HOST,
    loadavg,
    totalMemBytes,
    freeMemBytes,
    tickCount
  };
}
async function fetchAppDetail(appName, summary, doGitFetch, doLogPoll, signal) {
  const { app, pm2, restartDelta } = summary;
  if (signal?.aborted) {
    throw new Error("AbortError");
  }
  if (doLogPoll) await getSharedSsh();
  if (signal?.aborted) {
    throw new Error("AbortError");
  }
  const [portReachableResult, driftResult, routesResult] = await Promise.all([
    pm2?.status === "online" || !pm2 ? checkPortReachable(app.port).catch(() => false) : Promise.resolve(void 0),
    getVcsDriftInfo(app, path.join(app.appDir, "release"), doGitFetch).catch(
      () => ({
        branch: app.branch,
        behind: 0,
        ahead: 0,
        hasLocalChanges: false,
        fetched: false
      })
    ),
    RouteRepo.getAllByAppIdWithAppAndDomain(app.id).catch(
      () => []
    )
  ]);
  const portReachable = portReachableResult;
  const drift = driftResult;
  const routes = routesResult;
  if (signal?.aborted) {
    throw new Error("AbortError");
  }
  const seenDomains = /* @__PURE__ */ new Set();
  const domainInfoList = [];
  for (const route of routes) {
    if (signal?.aborted) {
      throw new Error("AbortError");
    }
    const domainName = route.domain.name;
    if (seenDomains.has(domainName)) continue;
    seenDomains.add(domainName);
    const domain = route.domain;
    const cert = buildCertInfo(domain);
    const isStale = isDomainStale(domain);
    const domainRoutes = await Promise.all(
      routes.filter((r) => r.domain.name === domainName).map(async (r) => {
        if (signal?.aborted) {
          throw new Error("AbortError");
        }
        const routePath = r.path === "" ? "/" : r.path;
        let nginxLog;
        if (domain.lastPushedAt) {
          const tailer = getTailer(domain, routePath, !!NGINX_REMOTE_HOST);
          if (doLogPoll) {
            await tailer.poll(signal).catch(() => {
            });
            if (signal?.aborted) {
              throw new Error("AbortError");
            }
          }
          nginxLog = tailer.getWindow();
        }
        return { path: routePath, appName: r.app.name, nginxLog };
      })
    );
    domainInfoList.push({
      name: domainName,
      cert,
      routes: domainRoutes,
      lastPushedAt: domain.lastPushedAt,
      lastCompiledAt: domain.lastCompiledAt,
      configPath: domain.configPath ?? void 0,
      isStale
    });
  }
  const envChanged = checkEnvChanged(app);
  const nginxWindows = domainInfoList.flatMap((d) => d.routes).filter((r) => r.nginxLog?.hasData).map((r) => r.nginxLog);
  const health = deriveHealth(pm2, portReachable, restartDelta, nginxWindows);
  return {
    appName,
    portReachable,
    drift,
    domains: domainInfoList,
    envChanged,
    health
  };
}
export {
  disconnectSharedSsh,
  fetchAppDetail,
  listApps,
  resetTailers
};
