import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { DETAIL_W } from '../shared.js';
const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\s*(.*)/s;
function classifySeverity(line) {
    if (line.includes('[err]') ||
        line.includes('Error') ||
        line.includes('ERROR'))
        return 'error';
    if (line.includes('warn') || line.includes('WARN'))
        return 'warn';
    return 'info';
}
function parseLogLine(raw) {
    const m = LOG_TS_RE.exec(raw);
    return {
        timestamp: m ? m[1] : '',
        message: m ? m[2] : raw,
        severity: classifySeverity(raw),
    };
}
export function LogsTab({ logLines, scrollOffset, maxVisible, }) {
    if (logLines.length === 0) {
        return (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, overflow: "hidden", children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: DETAIL_W, children: [_jsx(Text, { dimColor: true, children: "pm2 log \u2014 0 lines" }), _jsx(Text, { dimColor: true, children: "X clear" })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "No log output captured yet. Logs stream in as the app produces them." }) })] }));
    }
    const contentRows = Math.max(1, maxVisible - 3); // reserve header + hint rows like NginxLogsView
    const total = logLines.length;
    const maxOffset = Math.max(0, total - contentRows);
    const clampedOffset = Math.min(scrollOffset, maxOffset);
    const end = Math.max(0, total - clampedOffset);
    const start = Math.max(0, end - contentRows);
    const parsed = logLines.slice(start, end).map(parseLogLine);
    return (_jsxs(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, overflow: "hidden", children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: DETAIL_W, children: [_jsxs(Text, { dimColor: true, children: ["pm2 log \u2014 ", total, " ", total === 1 ? 'line' : 'lines', total > contentRows ? ` (${start + 1}–${end})` : '', clampedOffset > 0 ? '  ↑ scrolled' : '  ↓ live'] }), _jsx(Text, { dimColor: true, children: "X clear PgUp/PgDn" })] }), parsed.map((e, i) => {
                const ts = e.timestamp ? `${e.timestamp} ` : '';
                if (e.severity === 'error')
                    return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { dimColor: true, children: ts }), _jsx(Text, { color: "red", children: "\u2715" }), _jsx(Text, { color: "red", children: e.message })] }, i));
                if (e.severity === 'warn')
                    return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [ts !== '' && _jsx(Text, { dimColor: true, children: ts }), _jsx(Text, { color: "yellow", children: "!" }), _jsx(Text, { children: e.message })] }, i));
                return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsxs(Text, { dimColor: true, children: [ts, "\u00B7"] }), _jsx(Text, { dimColor: true, children: e.message })] }, i));
            })] }));
}
