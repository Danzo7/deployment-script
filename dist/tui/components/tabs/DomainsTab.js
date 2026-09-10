import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { DETAIL_W, fmtDate, truncate } from '../shared.js';
function certColor(cert) {
    if (cert.mode === 'none' || cert.isExpired || cert.error)
        return 'red';
    if (cert.daysRemaining !== undefined) {
        if (cert.daysRemaining < 7)
            return 'red';
        if (cert.daysRemaining < 30)
            return 'yellow';
        return 'green';
    }
    return 'green';
}
function certLabel(cert) {
    if (cert.mode === 'none')
        return '[no cert]';
    if (cert.error)
        return '[cert error]';
    if (cert.isExpired)
        return '[expired]';
    if (cert.daysRemaining !== undefined)
        return `[cert ${cert.daysRemaining}d]`;
    if (cert.mode === 'letsencrypt')
        return "[let's encrypt]";
    return '[cert]';
}
export function DomainsTab({ detail, maxVisible, }) {
    if (detail === null) {
        return (_jsx(Box, { width: DETAIL_W, children: _jsx(Text, { dimColor: true, children: "loading\u2026" }) }));
    }
    const { domains } = detail;
    if (domains.length === 0) {
        return (_jsx(Box, { width: DETAIL_W, children: _jsx(Text, { dimColor: true, children: "No domains configured for this app." }) }));
    }
    return (_jsx(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, overflow: "hidden", children: domains.map((domain, idx) => (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, marginTop: idx === 0 ? 0 : 1, children: [_jsxs(Box, { flexDirection: "row", gap: 1, width: DETAIL_W, children: [_jsx(Text, { bold: true, children: truncate(domain.name, DETAIL_W - 20) }), _jsx(Text, { color: certColor(domain.cert), children: certLabel(domain.cert) }), domain.isStale && _jsx(Text, { color: "yellow", children: "[config stale]" })] }), domain.cert.issuer && (_jsx(Box, { marginLeft: 2, children: _jsxs(Text, { dimColor: true, children: ["issuer: ", truncate(domain.cert.issuer, DETAIL_W - 12)] }) })), _jsx(Box, { marginLeft: 2, children: _jsxs(Text, { dimColor: true, children: ["pushed: ", fmtDate(domain.lastPushedAt)] }) }), _jsx(Box, { flexDirection: "column", marginLeft: 2, children: domain.routes.length === 0 ? (_jsx(Text, { dimColor: true, children: "no routes" })) : (domain.routes.map((r, ri) => (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { dimColor: true, children: [" ", r.path] }), _jsx(Text, { dimColor: true, children: " \u2192 " }), _jsx(Text, { children: r.appName })] }, ri)))) }), idx < domains.length - 1 && (_jsx(Text, { dimColor: true, children: '─'.repeat(Math.min(DETAIL_W, 40)) }))] }, domain.name))) }));
}
