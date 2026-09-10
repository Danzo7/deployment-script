import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { DETAIL_W, fmtMem, pad, truncate, sparkline } from '../shared.js';
// ─── Nginx log entry renderer ─────────────────────────────────────────────────
function statusColor(code) {
    if (code >= 500)
        return 'red';
    if (code >= 400)
        return 'yellow';
    if (code >= 300)
        return 'cyan';
    return 'green';
}
function fmtTs(ts) {
    const h = String(ts.getHours()).padStart(2, '0');
    const m = String(ts.getMinutes()).padStart(2, '0');
    const s = String(ts.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}
function fmtBytes(b) {
    if (b < 1024)
        return `${b}b`;
    if (b < 1024 * 1024)
        return `${(b / 1024).toFixed(0)}k`;
    return `${(b / 1024 / 1024).toFixed(1)}M`;
}
function NginxLogLine({ entry, width, }) {
    const ts = fmtTs(entry.ts);
    const method = pad(entry.method, 4);
    const status = String(entry.status);
    const rt = entry.responseTime !== undefined
        ? `${(entry.responseTime * 1000).toFixed(0)}ms`
        : '';
    const bytes = fmtBytes(entry.bytes);
    const addr = entry.remoteAddr || '';
    // Reserve space: ts(8) + method(5) + status(4) + rt(7) + bytes(6) + addr(16) + gaps = ~50
    const uriWidth = Math.max(8, width - 50);
    const uri = truncate(entry.uri, uriWidth);
    return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: ts }), addr ? _jsx(Text, { color: "cyan", children: addr }) : null, _jsx(Text, { dimColor: true, children: method }), _jsx(Text, { color: statusColor(entry.status), children: status }), _jsx(Text, { children: uri }), rt ? _jsx(Text, { dimColor: true, children: rt }) : null, _jsx(Text, { dimColor: true, children: bytes })] }));
}
// ─── Logs sub-view ────────────────────────────────────────────────────────────
function NginxLogsView({ detail, scrollOffset, maxVisible, }) {
    if (!detail) {
        return (_jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: "loading\u2026" }) }));
    }
    // Collect all entries across all domains/routes, sorted newest-first
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
        const isLoading = detail.domains.some((d) => d.routes.some((r) => r.nginxLog?.loading));
        return (_jsx(Box, { flexDirection: "column", marginLeft: 2, children: _jsx(Text, { dimColor: true, children: isLoading
                    ? 'loading…'
                    : hasUnpushed
                        ? 'not pushed to Nginx — no access logs available'
                        : 'no requests recorded yet' }) }));
    }
    // Sort chronologically (oldest first) — same as LogsTab scroll model
    allEntries.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const contentRows = Math.max(1, maxVisible - 3); // header + hint rows
    const total = allEntries.length;
    // scrollOffset=0 → tail; PgUp increases offset → scroll back in history
    // Clamp so we never scroll past the first line
    const maxOffset = Math.max(0, total - contentRows);
    const clampedOffset = Math.min(scrollOffset, maxOffset);
    const end = Math.max(0, total - clampedOffset);
    const start = Math.max(0, end - contentRows);
    const visible = allEntries.slice(start, end);
    return (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: DETAIL_W, children: [_jsxs(Text, { dimColor: true, children: ["nginx access log \u2014 ", total, " entries", total > contentRows ? ` (${start + 1}–${end})` : '', clampedOffset > 0 ? '  ↑ scrolled' : '  ↓ live'] }), _jsx(Text, { dimColor: true, children: "PgUp/PgDn scroll" })] }), visible.map((entry, i) => (_jsx(Box, { children: _jsx(NginxLogLine, { entry: entry, width: DETAIL_W }) }, `${entry.ts.getTime()}-${i}`)))] }));
}
// ─── Stats sub-view ───────────────────────────────────────────────────────────
function StatsView({ summary, detail, cpuHistory, memHistory, totalMemBytes, maxVisible, }) {
    const { pm2, pm2Error, restartDelta } = summary;
    const domains = detail?.domains ?? [];
    function gaugeBar(f, w = 10) {
        const n = Math.round(Math.max(0, Math.min(1, f)) * w);
        return '█'.repeat(n) + '░'.repeat(w - n);
    }
    const cpuStr = sparkline(cpuHistory, 20);
    const cpuVal = pm2Error
        ? pm2Error
        : !pm2
            ? 'PM2 unreachable'
            : `${pm2.cpu.toFixed(1)}%`;
    const memStr = sparkline(memHistory, 20);
    const memVal = pm2Error || !pm2 ? (pm2Error ?? 'PM2 unreachable') : fmtMem(pm2.memBytes);
    const memFrac = pm2 && totalMemBytes ? pm2.memBytes / totalMemBytes : 0;
    const showGauge = !!(pm2 && totalMemBytes);
    const hasDomains = domains.length > 0;
    return (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, gap: 1, overflow: "hidden", children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: pad('CPU:', 8) }), _jsx(Text, { color: "green", children: cpuStr }), _jsx(Text, { children: " " }), pm2Error || !pm2 ? (_jsx(Text, { dimColor: true, children: cpuVal })) : (_jsx(Text, { children: cpuVal }))] }), _jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: pad('Memory:', 8) }), _jsx(Text, { color: "blue", children: memStr }), _jsx(Text, { children: " " }), pm2Error || !pm2 ? (_jsx(Text, { dimColor: true, children: memVal })) : (_jsxs(_Fragment, { children: [_jsx(Text, { children: memVal }), showGauge && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "[" }), _jsx(Text, { color: memFrac > 0.85 ? 'red' : memFrac > 0.6 ? 'yellow' : 'green', children: gaugeBar(memFrac) }), _jsx(Text, { dimColor: true, children: "]" })] }))] }))] }), restartDelta >= 3 && (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: "yellow", children: "\u26A0" }), _jsxs(Text, { color: "yellow", children: [restartDelta, " restarts since dashboard opened"] })] })), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Request metrics" }), detail === null ? (_jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: "loading\u2026" }) })) : !hasDomains ? (_jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: "No domain routed to this app \u2014 request metrics require a proxied domain" }) })) : (domains.map((domain) => domain.routes.map((route) => (_jsxs(Box, { flexDirection: "column", marginTop: 1, marginLeft: 2, children: [_jsxs(Text, { bold: true, children: [truncate(domain.name, DETAIL_W - 10), _jsx(Text, { dimColor: true, children: '/' + route.path.replace(/^\//, '') })] }), !domain.lastPushedAt && (_jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: "not pushed to Nginx \u2014 no request metrics available" }) })), domain.lastPushedAt &&
                                (!route.nginxLog || !route.nginxLog.hasData) && (_jsxs(Box, { marginLeft: 2, flexDirection: "column", children: [route.nginxLog?.loading ? (_jsx(Text, { dimColor: true, children: "loading\u2026" })) : route.nginxLog?.error ? (_jsxs(Text, { color: "red", children: ["log error \u2014", ' ', truncate(route.nginxLog.error, DETAIL_W - 14)] })) : (_jsx(Text, { dimColor: true, children: "no requests recorded yet \u2014 metrics will appear once traffic flows" })), route.nginxLog && !route.nginxLog.loading && (_jsxs(Text, { dimColor: true, children: [' ', "path:", ' ', truncate(route.nginxLog.logPath, DETAIL_W - 10)] })), route.nginxLog?.rawSample && (_jsxs(Text, { dimColor: true, children: [' ', "raw:", ' ', truncate(route.nginxLog.rawSample.replace(/\n/g, '↵'), DETAIL_W - 8)] })), route.nginxLog &&
                                        !route.nginxLog.loading &&
                                        !route.nginxLog.error &&
                                        !route.nginxLog.rawSample && (_jsx(Text, { dimColor: true, children: " (file read returned empty)" }))] })), domain.lastPushedAt && route.nginxLog?.hasData && (_jsxs(Box, { flexDirection: "column", marginLeft: 2, children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: pad('req/s:', 8) }), _jsx(Text, { color: "yellow", children: route.nginxLog.reqPerSec.toFixed(1) })] }), _jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsx(Text, { dimColor: true, children: "status:" }), _jsxs(Text, { color: "green", children: ["2XX ", route.nginxLog.statusDist.s2xx] }), _jsxs(Text, { color: "yellow", children: ["4XX ", route.nginxLog.statusDist.s4xx] }), _jsxs(Text, { color: "red", children: ["5XX ", route.nginxLog.statusDist.s5xx] })] }), route.nginxLog.p50ms !== undefined && (_jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsx(Text, { dimColor: true, children: "latency:" }), _jsxs(Text, { children: ["p50 ", route.nginxLog.p50ms, "ms"] }), route.nginxLog.p95ms !== undefined && (_jsxs(Text, { children: ["p95 ", route.nginxLog.p95ms, "ms"] }))] })), route.nginxLog.noResponseTime && (_jsx(Text, { dimColor: true, children: "response times unavailable \u2014 regenerate nginx config for dm_json format" }))] }))] }, `${domain.name}:${route.path}`)))))] })] }));
}
// ─── MetricsTab ───────────────────────────────────────────────────────────────
export function MetricsTab({ summary, detail, cpuHistory, memHistory, totalMemBytes, maxVisible, scrollOffset, metricsView, }) {
    return (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, overflow: "hidden", children: [_jsxs(Box, { flexDirection: "row", gap: 2, marginBottom: 1, children: [_jsx(Text, { bold: metricsView === 'stats', color: metricsView === 'stats' ? 'yellow' : undefined, dimColor: metricsView !== 'stats', children: "stats" }), _jsx(Text, { dimColor: true, children: "\u2502" }), _jsx(Text, { bold: metricsView === 'logs', color: metricsView === 'logs' ? 'yellow' : undefined, dimColor: metricsView !== 'logs', children: "access logs" }), _jsx(Text, { dimColor: true, children: " v to toggle" })] }), metricsView === 'stats' ? (_jsx(StatsView, { summary: summary, detail: detail, cpuHistory: cpuHistory, memHistory: memHistory, totalMemBytes: totalMemBytes, maxVisible: maxVisible - 2 })) : (_jsx(NginxLogsView, { detail: detail, scrollOffset: scrollOffset, maxVisible: maxVisible - 2 }))] }));
}
