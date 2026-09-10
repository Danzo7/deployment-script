import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';
function Hint({ label, desc }) {
    return (_jsxs(_Fragment, { children: [_jsx(Text, { bold: true, color: "white", children: label }), _jsx(Text, { dimColor: true, children: ` ${desc}  ` })] }));
}
export function Keybar({ activeTab }) {
    const tabHints = (() => {
        switch (activeTab) {
            case 'overview':
                return (_jsxs(_Fragment, { children: [_jsx(Hint, { label: "r", desc: "restart" }), _jsx(Hint, { label: "S", desc: "stop" }), _jsx(Hint, { label: "D", desc: "redeploy" }), _jsx(Hint, { label: "E", desc: "env" })] }));
            case 'metrics':
                return (_jsxs(_Fragment, { children: [_jsx(Hint, { label: "v", desc: "toggle logs" }), _jsx(Hint, { label: "c", desc: "copy value" })] }));
            case 'logs':
                return (_jsxs(_Fragment, { children: [_jsx(Hint, { label: "X", desc: "clear" }), _jsx(Hint, { label: "c", desc: "copy line" })] }));
            case 'deploys':
                return (_jsxs(_Fragment, { children: [_jsx(Hint, { label: "\u21B5", desc: "rollback" }), _jsx(Hint, { label: "c", desc: "copy commit" })] }));
            case 'domains':
                return (_jsxs(_Fragment, { children: [_jsx(Hint, { label: "\u21B5", desc: "nginx config" }), _jsx(Hint, { label: "c", desc: "copy url" })] }));
        }
    })();
    return (_jsxs(Box, { flexDirection: "column", width: TERM_W, children: [_jsx(Text, { dimColor: true, children: '─'.repeat(TERM_W) }), _jsxs(Box, { flexDirection: "row", children: [_jsx(Hint, { label: "Tab", desc: "switch tab" }), _jsx(Hint, { label: "PgUp/PgDn", desc: "scroll" }), _jsx(Hint, { label: "Esc", desc: "dismiss" }), _jsx(Hint, { label: "q", desc: "quit" }), tabHints] })] }));
}
