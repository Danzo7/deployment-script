import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';
export function TopBar({ pm2Reachable, dbReachable, sshReachable, sshHost, }) {
    const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 8));
    useEffect(() => {
        const id = setInterval(() => setTime(new Date().toTimeString().slice(0, 8)), 1000);
        return () => clearInterval(id);
    }, []);
    return (_jsxs(Box, { flexDirection: "column", width: TERM_W, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: TERM_W, children: [_jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsx(Text, { bold: true, color: "yellow", children: "dm" }), _jsxs(Box, { flexDirection: "row", gap: 0, children: [_jsx(Text, { color: pm2Reachable ? 'green' : 'red', children: "\u25CF" }), _jsx(Text, { children: " pm2" })] }), _jsxs(Box, { flexDirection: "row", gap: 0, children: [_jsx(Text, { color: dbReachable ? 'green' : 'red', children: "\u25CF" }), _jsx(Text, { children: " db" })] }), sshHost != null && (_jsxs(Box, { flexDirection: "row", gap: 0, children: [_jsx(Text, { color: sshReachable ? 'green' : 'yellow', children: "\u25CF" }), _jsxs(Text, { children: [" ssh:", sshHost] })] }))] }), _jsx(Text, { children: time })] }), _jsx(Text, { dimColor: true, children: '─'.repeat(TERM_W) })] }));
}
