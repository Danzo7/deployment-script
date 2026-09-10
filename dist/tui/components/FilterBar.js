import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';
export function FilterBar({ active, query, }) {
    return (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: TERM_W, children: [active ? (_jsxs(Text, { children: [query, _jsx(Text, { bold: true, color: "yellow", children: "\u2588" })] })) : (_jsx(Text, { dimColor: true, children: "filter apps\u2026" })), _jsx(Text, { dimColor: true, children: '/ search  : command  s sort' })] }));
}
