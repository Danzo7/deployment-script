import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { DETAIL_W, fmtUptime, fmtDate, truncate, pad, } from '../shared.js';
export function OverviewTab({ summary, detail, }) {
    const { app, config, pm2 } = summary;
    const drift = detail?.drift ?? null;
    const domains = detail?.domains ?? [];
    const envChanged = detail?.envChanged;
    const portReachable = detail?.portReachable;
    function vcsStatus() {
        if (!drift)
            return 'unknown';
        if (drift.behind > 0 && drift.ahead > 0)
            return 'diverged';
        if (drift.behind > 0)
            return 'behind';
        if (drift.ahead > 0)
            return 'ahead';
        return 'up-to-date';
    }
    function vcsColor(s) {
        return s === 'up-to-date'
            ? 'green'
            : s === 'diverged'
                ? 'red'
                : s === 'unknown'
                    ? 'gray'
                    : 'yellow';
    }
    function vcsLabel(s) {
        return s === 'up-to-date' ? 'up to date' : s;
    }
    const firstCert = (() => {
        for (const d of domains) {
            if (d.cert.mode !== 'none')
                return d.cert;
        }
        return null;
    })();
    function certBadgeColor(days) {
        if (days === undefined)
            return 'gray';
        return days < 7 ? 'red' : days < 30 ? 'yellow' : 'green';
    }
    const status = vcsStatus();
    const commit = app.lastDeployedCommit;
    const shortHash = commit?.hash ? commit.hash.slice(0, 7) : '—';
    const allRoutes = [];
    for (const d of domains) {
        const protocol = d.cert.mode === 'none' ? 'http' : 'https';
        for (const r of d.routes) {
            const pathPart = r.path === '/' || r.path === '' ? '/' : `/${r.path.replace(/^\//, '')}`;
            let sslLabel = 'no SSL';
            if (d.cert.mode !== 'none') {
                if (d.cert.isExpired)
                    sslLabel = 'SSL expired';
                else if (d.cert.expiringSoon)
                    sslLabel = `SSL expires ${d.cert.daysRemaining}d`;
                else if (d.cert.daysRemaining !== undefined)
                    sslLabel = `SSL valid · ${d.cert.daysRemaining}d`;
                else
                    sslLabel = d.cert.mode;
            }
            allRoutes.push({
                url: `${protocol}://${d.name}${pathPart}`,
                sslLabel,
                certValid: !d.cert.isExpired && d.cert.mode !== 'none',
            });
        }
    }
    const KVItem = ({ label, value, valueColor, }) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: pad(label + ':', 12) }), valueColor ? (_jsx(Text, { color: valueColor, children: truncate(value, DETAIL_W / 2 - 14) })) : (_jsx(Text, { children: truncate(value, DETAIL_W / 2 - 14) }))] }));
    const half = Math.floor(DETAIL_W / 2);
    return (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, gap: 1, children: [_jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsxs(Box, { flexDirection: "column", width: half, children: [_jsx(KVItem, { label: "Port", value: String(app.port) }), _jsx(KVItem, { label: "Type", value: app.projectType ?? '—' }), _jsx(KVItem, { label: "Instances", value: String(config.instances) }), _jsx(KVItem, { label: "Max Memory", value: config.maxMemory }), _jsx(KVItem, { label: "Branch", value: drift?.branch ?? app.branch ?? '—' }), _jsx(KVItem, { label: "Uptime", value: pm2?.status === 'online' ? fmtUptime(pm2.uptimeMs) : '—' }), _jsx(KVItem, { label: "Exec Mode", value: pm2?.execMode ?? '—' }), _jsx(KVItem, { label: "PID", value: pm2?.pid != null ? String(pm2.pid) : '—' }), portReachable !== undefined && (_jsx(KVItem, { label: "Port check", value: portReachable ? 'reachable' : 'unreachable', valueColor: portReachable ? 'green' : 'red' }))] }), _jsxs(Box, { flexDirection: "column", width: half, children: [_jsx(KVItem, { label: "Commit", value: shortHash, valueColor: "yellow" }), _jsx(KVItem, { label: "Deployed", value: fmtDate(app.lastDeploy) }), _jsx(KVItem, { label: "Restarts", value: String(pm2?.restarts ?? 0) }), _jsx(KVItem, { label: "Active Build", value: app.activeBuild
                                    ? (app.activeBuild
                                        .replace(/[/\\]+$/, '')
                                        .split(/[/\\]/)
                                        .pop() ?? '—') +
                                        (app.builds?.length ? ` (${app.builds.length})` : '')
                                    : '—' }), _jsx(KVItem, { label: "Script", value: pm2?.scriptPath ?? '—' })] })] }), _jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsxs(Text, { color: vcsColor(status), children: ["[", vcsLabel(status), "]"] }), firstCert ? (_jsx(Text, { color: certBadgeColor(firstCert.daysRemaining), children: firstCert.daysRemaining !== undefined
                            ? `[cert ${firstCert.daysRemaining}d]`
                            : '[cert —]' })) : (_jsx(Text, { dimColor: true, children: "[no cert]" })), envChanged === true && _jsx(Text, { color: "yellow", children: "[env changed]" })] }), detail === null && (_jsx(Box, { children: _jsx(Text, { dimColor: true, children: "loading detail\u2026" }) })), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Last commit" }), _jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: truncate(commit?.message ?? '—', DETAIL_W - 4) }) }), _jsxs(Box, { flexDirection: "row", gap: 2, marginLeft: 2, children: [_jsx(Text, { children: commit?.author ?? '—' }), _jsx(Text, { dimColor: true, children: commit?.date ? fmtDate(new Date(commit.date)) : '—' })] })] }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Routes" }), allRoutes.length === 0 ? (_jsx(Box, { marginLeft: 2, children: _jsx(Text, { dimColor: true, children: detail === null ? 'loading…' : 'No routes configured' }) })) : (allRoutes.map((r, i) => (_jsxs(Box, { flexDirection: "row", gap: 1, marginLeft: 2, children: [_jsx(Text, { color: "magenta", children: truncate(r.url, DETAIL_W - 20) }), _jsx(Text, { dimColor: true, color: r.certValid
                                    ? 'green'
                                    : r.sslLabel === 'no SSL'
                                        ? undefined
                                        : 'yellow', children: r.sslLabel })] }, i))))] })] }));
}
