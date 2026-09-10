import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { TERM_W, TOAST_TTL_TICKS } from './shared.js';
export function CrashLoopToast({ appName, restartCount, tickCount, onDismiss, }) {
    useEffect(() => {
        if (tickCount >= TOAST_TTL_TICKS)
            onDismiss();
    }, [tickCount, onDismiss]);
    return (_jsxs(Box, { flexDirection: "row", width: TERM_W, children: [_jsx(Text, { color: "yellow", children: "\u258C \u26A0 " }), _jsxs(Text, { children: [appName, " has restarted ", restartCount, ' ', restartCount === 1 ? 'time' : 'times'] }), _jsx(Text, { dimColor: true, children: " L to view logs" })] }));
}
