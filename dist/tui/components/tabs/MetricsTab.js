import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { DETAIL_W, fmtMem, pad, truncate, sparkline } from "../shared.js";
function statusColor(code) {
  if (code >= 500) return "red";
  if (code >= 400) return "yellow";
  if (code >= 300) return "cyan";
  return "green";
}
function fmtTs(ts) {
  const h = String(ts.getHours()).padStart(2, "0");
  const m = String(ts.getMinutes()).padStart(2, "0");
  const s = String(ts.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function fmtBytes(b) {
  if (b < 1024) return `${b}b`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}k`;
  return `${(b / 1024 / 1024).toFixed(1)}M`;
}
function NginxLogLine({
  entry,
  width
}) {
  const ts = fmtTs(entry.ts);
  const method = pad(entry.method, 4);
  const status = String(entry.status);
  const rt = entry.responseTime !== void 0 ? `${(entry.responseTime * 1e3).toFixed(0)}ms` : "";
  const bytes = fmtBytes(entry.bytes);
  const addr = entry.remoteAddr || "";
  const uriWidth = Math.max(8, width - 50);
  const uri = truncate(entry.uri, uriWidth);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: ts }),
    addr ? /* @__PURE__ */ jsx(Text, { color: "cyan", children: addr }) : null,
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: method }),
    /* @__PURE__ */ jsx(Text, { color: statusColor(entry.status), children: status }),
    /* @__PURE__ */ jsx(Text, { children: uri }),
    rt ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: rt }) : null,
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: bytes })
  ] });
}
function NginxLogsView({
  detail,
  scrollOffset,
  maxVisible
}) {
  if (!detail) {
    return /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "loading\u2026" }) });
  }
  const allEntries = [];
  for (const domain of detail.domains) {
    for (const route of domain.routes) {
      if (route.nginxLog?.recentEntries) {
        allEntries.push(...route.nginxLog.recentEntries);
      }
    }
  }
  if (allEntries.length === 0) {
    const hasUnpushed = detail.domains.some((d) => !d.lastPushedAt);
    const isLoading = detail.domains.some(
      (d) => d.routes.some((r) => r.nginxLog?.loading)
    );
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: isLoading ? "loading\u2026" : hasUnpushed ? "not pushed to Nginx \u2014 no access logs available" : "no requests recorded yet" }) });
  }
  allEntries.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const contentRows = Math.max(1, maxVisible - 3);
  const total = allEntries.length;
  const maxOffset = Math.max(0, total - contentRows);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const end = Math.max(0, total - clampedOffset);
  const start = Math.max(0, end - contentRows);
  const visible = allEntries.slice(start, end);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: DETAIL_W, children: [
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: DETAIL_W, children: [
      /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
        "nginx access log \u2014 ",
        total,
        " entries",
        total > contentRows ? ` (${start + 1}\u2013${end})` : "",
        clampedOffset > 0 ? "  \u2191 scrolled" : "  \u2193 live"
      ] }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "PgUp/PgDn scroll" })
    ] }),
    visible.map((entry, i) => /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(NginxLogLine, { entry, width: DETAIL_W }) }, `${entry.ts.getTime()}-${i}`))
  ] });
}
function StatsView({
  summary,
  detail,
  cpuHistory,
  memHistory,
  totalMemBytes,
  maxVisible
}) {
  const { pm2, pm2Error, restartDelta } = summary;
  const domains = detail?.domains ?? [];
  function gaugeBar(f, w = 10) {
    const n = Math.round(Math.max(0, Math.min(1, f)) * w);
    return "\u2588".repeat(n) + "\u2591".repeat(w - n);
  }
  const cpuStr = sparkline(cpuHistory, 20);
  const cpuVal = pm2Error ? pm2Error : !pm2 ? "PM2 unreachable" : `${pm2.cpu.toFixed(1)}%`;
  const memStr = sparkline(memHistory, 20);
  const memVal = pm2Error || !pm2 ? pm2Error ?? "PM2 unreachable" : fmtMem(pm2.memBytes);
  const memFrac = pm2 && totalMemBytes ? pm2.memBytes / totalMemBytes : 0;
  const showGauge = !!(pm2 && totalMemBytes);
  const hasDomains = domains.length > 0;
  return /* @__PURE__ */ jsxs(
    Box,
    {
      flexDirection: "column",
      width: DETAIL_W,
      height: maxVisible,
      gap: 1,
      overflow: "hidden",
      children: [
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: pad("CPU:", 8) }),
          /* @__PURE__ */ jsx(Text, { color: "green", children: cpuStr }),
          /* @__PURE__ */ jsx(Text, { children: " " }),
          pm2Error || !pm2 ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: cpuVal }) : /* @__PURE__ */ jsx(Text, { children: cpuVal })
        ] }),
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: pad("Memory:", 8) }),
          /* @__PURE__ */ jsx(Text, { color: "blue", children: memStr }),
          /* @__PURE__ */ jsx(Text, { children: " " }),
          pm2Error || !pm2 ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: memVal }) : /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(Text, { children: memVal }),
            showGauge && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { children: " " }),
              /* @__PURE__ */ jsx(Text, { dimColor: true, children: "[" }),
              /* @__PURE__ */ jsx(
                Text,
                {
                  color: memFrac > 0.85 ? "red" : memFrac > 0.6 ? "yellow" : "green",
                  children: gaugeBar(memFrac)
                }
              ),
              /* @__PURE__ */ jsx(Text, { dimColor: true, children: "]" })
            ] })
          ] })
        ] }),
        restartDelta >= 3 && /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
          /* @__PURE__ */ jsx(Text, { color: "yellow", children: "\u26A0" }),
          /* @__PURE__ */ jsxs(Text, { color: "yellow", children: [
            restartDelta,
            " restarts since dashboard opened"
          ] })
        ] }),
        /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Request metrics" }),
          detail === null ? /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "loading\u2026" }) }) : !hasDomains ? /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "No domain routed to this app \u2014 request metrics require a proxied domain" }) }) : domains.map(
            (domain) => domain.routes.map((route) => /* @__PURE__ */ jsxs(
              Box,
              {
                flexDirection: "column",
                marginTop: 1,
                marginLeft: 2,
                children: [
                  /* @__PURE__ */ jsxs(Text, { bold: true, children: [
                    truncate(domain.name, DETAIL_W - 10),
                    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "/" + route.path.replace(/^\//, "") })
                  ] }),
                  !domain.lastPushedAt && /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "not pushed to Nginx \u2014 no request metrics available" }) }),
                  domain.lastPushedAt && (!route.nginxLog || !route.nginxLog.hasData) && /* @__PURE__ */ jsxs(Box, { marginLeft: 2, flexDirection: "column", children: [
                    route.nginxLog?.loading ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: "loading\u2026" }) : route.nginxLog?.error ? /* @__PURE__ */ jsxs(Text, { color: "red", children: [
                      "log error \u2014",
                      " ",
                      truncate(route.nginxLog.error, DETAIL_W - 14)
                    ] }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: "no requests recorded yet \u2014 metrics will appear once traffic flows" }),
                    route.nginxLog && !route.nginxLog.loading && /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
                      " ",
                      "path:",
                      " ",
                      truncate(route.nginxLog.logPath, DETAIL_W - 10)
                    ] }),
                    route.nginxLog?.rawSample && /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
                      " ",
                      "raw:",
                      " ",
                      truncate(
                        route.nginxLog.rawSample.replace(/\n/g, "\u21B5"),
                        DETAIL_W - 8
                      )
                    ] }),
                    route.nginxLog && !route.nginxLog.loading && !route.nginxLog.error && !route.nginxLog.rawSample && /* @__PURE__ */ jsx(Text, { dimColor: true, children: " (file read returned empty)" })
                  ] }),
                  domain.lastPushedAt && route.nginxLog?.hasData && /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginLeft: 2, children: [
                    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
                      /* @__PURE__ */ jsx(Text, { dimColor: true, children: pad("req/s:", 8) }),
                      /* @__PURE__ */ jsx(Text, { color: "yellow", children: route.nginxLog.reqPerSec.toFixed(1) })
                    ] }),
                    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
                      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "status:" }),
                      /* @__PURE__ */ jsxs(Text, { color: "green", children: [
                        "2XX ",
                        route.nginxLog.statusDist.s2xx
                      ] }),
                      /* @__PURE__ */ jsxs(Text, { color: "yellow", children: [
                        "4XX ",
                        route.nginxLog.statusDist.s4xx
                      ] }),
                      /* @__PURE__ */ jsxs(Text, { color: "red", children: [
                        "5XX ",
                        route.nginxLog.statusDist.s5xx
                      ] })
                    ] }),
                    route.nginxLog.p50ms !== void 0 && /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
                      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "latency:" }),
                      /* @__PURE__ */ jsxs(Text, { children: [
                        "p50 ",
                        route.nginxLog.p50ms,
                        "ms"
                      ] }),
                      route.nginxLog.p95ms !== void 0 && /* @__PURE__ */ jsxs(Text, { children: [
                        "p95 ",
                        route.nginxLog.p95ms,
                        "ms"
                      ] })
                    ] }),
                    route.nginxLog.noResponseTime && /* @__PURE__ */ jsx(Text, { dimColor: true, children: "response times unavailable \u2014 regenerate nginx config for dm_json format" })
                  ] })
                ]
              },
              `${domain.name}:${route.path}`
            ))
          )
        ] })
      ]
    }
  );
}
function MetricsTab({
  summary,
  detail,
  cpuHistory,
  memHistory,
  totalMemBytes,
  maxVisible,
  scrollOffset,
  metricsView
}) {
  return /* @__PURE__ */ jsxs(
    Box,
    {
      flexDirection: "column",
      width: DETAIL_W,
      height: maxVisible,
      overflow: "hidden",
      children: [
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, marginBottom: 1, children: [
          /* @__PURE__ */ jsx(
            Text,
            {
              bold: metricsView === "stats",
              color: metricsView === "stats" ? "yellow" : void 0,
              dimColor: metricsView !== "stats",
              children: "stats"
            }
          ),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2502" }),
          /* @__PURE__ */ jsx(
            Text,
            {
              bold: metricsView === "logs",
              color: metricsView === "logs" ? "yellow" : void 0,
              dimColor: metricsView !== "logs",
              children: "access logs"
            }
          ),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: " v to toggle" })
        ] }),
        metricsView === "stats" ? /* @__PURE__ */ jsx(
          StatsView,
          {
            summary,
            detail,
            cpuHistory,
            memHistory,
            totalMemBytes,
            maxVisible: maxVisible - 2
          }
        ) : /* @__PURE__ */ jsx(
          NginxLogsView,
          {
            detail,
            scrollOffset,
            maxVisible: maxVisible - 2
          }
        )
      ]
    }
  );
}
export {
  MetricsTab
};
