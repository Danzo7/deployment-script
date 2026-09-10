import { jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import {
  DETAIL_W,
  fmtUptime,
  fmtDate,
  truncate,
  pad
} from "../shared.js";
function OverviewTab({
  summary,
  detail
}) {
  const { app, config, pm2 } = summary;
  const drift = detail?.drift ?? null;
  const domains = detail?.domains ?? [];
  const envChanged = detail?.envChanged;
  const portReachable = detail?.portReachable;
  function vcsStatus() {
    if (!drift) return "unknown";
    if (drift.behind > 0 && drift.ahead > 0) return "diverged";
    if (drift.behind > 0) return "behind";
    if (drift.ahead > 0) return "ahead";
    return "up-to-date";
  }
  function vcsColor(s) {
    return s === "up-to-date" ? "green" : s === "diverged" ? "red" : s === "unknown" ? "gray" : "yellow";
  }
  function vcsLabel(s) {
    return s === "up-to-date" ? "up to date" : s;
  }
  const firstCert = (() => {
    for (const d of domains) {
      if (d.cert.mode !== "none") return d.cert;
    }
    return null;
  })();
  function certBadgeColor(days) {
    if (days === void 0) return "gray";
    return days < 7 ? "red" : days < 30 ? "yellow" : "green";
  }
  const status = vcsStatus();
  const commit = app.lastDeployedCommit;
  const shortHash = commit?.hash ? commit.hash.slice(0, 7) : "\u2014";
  const allRoutes = [];
  for (const d of domains) {
    const protocol = d.cert.mode === "none" ? "http" : "https";
    for (const r of d.routes) {
      const pathPart = r.path === "/" || r.path === "" ? "/" : `/${r.path.replace(/^\//, "")}`;
      let sslLabel = "no SSL";
      if (d.cert.mode !== "none") {
        if (d.cert.isExpired) sslLabel = "SSL expired";
        else if (d.cert.expiringSoon)
          sslLabel = `SSL expires ${d.cert.daysRemaining}d`;
        else if (d.cert.daysRemaining !== void 0)
          sslLabel = `SSL valid \xB7 ${d.cert.daysRemaining}d`;
        else sslLabel = d.cert.mode;
      }
      allRoutes.push({
        url: `${protocol}://${d.name}${pathPart}`,
        sslLabel,
        certValid: !d.cert.isExpired && d.cert.mode !== "none"
      });
    }
  }
  const KVItem = ({
    label,
    value,
    valueColor
  }) => /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: pad(label + ":", 12) }),
    valueColor ? /* @__PURE__ */ jsx(Text, { color: valueColor, children: truncate(value, DETAIL_W / 2 - 14) }) : /* @__PURE__ */ jsx(Text, { children: truncate(value, DETAIL_W / 2 - 14) })
  ] });
  const half = Math.floor(DETAIL_W / 2);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: DETAIL_W, gap: 1, children: [
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
      /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: half, children: [
        /* @__PURE__ */ jsx(KVItem, { label: "Port", value: String(app.port) }),
        /* @__PURE__ */ jsx(KVItem, { label: "Type", value: app.projectType ?? "\u2014" }),
        /* @__PURE__ */ jsx(KVItem, { label: "Instances", value: String(config.instances) }),
        /* @__PURE__ */ jsx(KVItem, { label: "Max Memory", value: config.maxMemory }),
        /* @__PURE__ */ jsx(KVItem, { label: "Branch", value: drift?.branch ?? app.branch ?? "\u2014" }),
        /* @__PURE__ */ jsx(
          KVItem,
          {
            label: "Uptime",
            value: pm2?.status === "online" ? fmtUptime(pm2.uptimeMs) : "\u2014"
          }
        ),
        /* @__PURE__ */ jsx(KVItem, { label: "Exec Mode", value: pm2?.execMode ?? "\u2014" }),
        /* @__PURE__ */ jsx(
          KVItem,
          {
            label: "PID",
            value: pm2?.pid != null ? String(pm2.pid) : "\u2014"
          }
        ),
        portReachable !== void 0 && /* @__PURE__ */ jsx(
          KVItem,
          {
            label: "Port check",
            value: portReachable ? "reachable" : "unreachable",
            valueColor: portReachable ? "green" : "red"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: half, children: [
        /* @__PURE__ */ jsx(KVItem, { label: "Commit", value: shortHash, valueColor: "yellow" }),
        /* @__PURE__ */ jsx(KVItem, { label: "Deployed", value: fmtDate(app.lastDeploy) }),
        /* @__PURE__ */ jsx(KVItem, { label: "Restarts", value: String(pm2?.restarts ?? 0) }),
        /* @__PURE__ */ jsx(
          KVItem,
          {
            label: "Active Build",
            value: app.activeBuild ? (app.activeBuild.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "\u2014") + (app.builds?.length ? ` (${app.builds.length})` : "") : "\u2014"
          }
        ),
        /* @__PURE__ */ jsx(KVItem, { label: "Script", value: pm2?.scriptPath ?? "\u2014" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
      /* @__PURE__ */ jsxs(Text, { color: vcsColor(status), children: [
        "[",
        vcsLabel(status),
        "]"
      ] }),
      firstCert ? /* @__PURE__ */ jsx(Text, { color: certBadgeColor(firstCert.daysRemaining), children: firstCert.daysRemaining !== void 0 ? `[cert ${firstCert.daysRemaining}d]` : "[cert \u2014]" }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: "[no cert]" }),
      envChanged === true && /* @__PURE__ */ jsx(Text, { color: "yellow", children: "[env changed]" })
    ] }),
    detail === null && /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "loading detail\u2026" }) }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Last commit" }),
      /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: truncate(commit?.message ?? "\u2014", DETAIL_W - 4) }) }),
      /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, marginLeft: 2, children: [
        /* @__PURE__ */ jsx(Text, { children: commit?.author ?? "\u2014" }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: commit?.date ? fmtDate(new Date(commit.date)) : "\u2014" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Routes" }),
      allRoutes.length === 0 ? /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: detail === null ? "loading\u2026" : "No routes configured" }) }) : allRoutes.map((r, i) => /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, marginLeft: 2, children: [
        /* @__PURE__ */ jsx(Text, { color: "magenta", children: truncate(r.url, DETAIL_W - 20) }),
        /* @__PURE__ */ jsx(
          Text,
          {
            dimColor: true,
            color: r.certValid ? "green" : r.sslLabel === "no SSL" ? void 0 : "yellow",
            children: r.sslLabel
          }
        )
      ] }, i))
    ] })
  ] });
}
export {
  OverviewTab
};
