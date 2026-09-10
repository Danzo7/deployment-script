import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { TERM_W } from './shared.js';
export function ConfirmDialog({ title, description, }) {
    return (_jsxs(Box, { flexDirection: "column", alignSelf: "center", width: Math.min(50, TERM_W - 4), borderStyle: "round", borderColor: "red", children: [_jsx(Text, { color: "red", children: title }), _jsx(Text, { children: description }), _jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { bold: true, color: "white", children: "y" }), _jsx(Text, { dimColor: true, children: ' confirm  ' }), _jsx(Text, { bold: true, color: "white", children: "n" }), _jsx(Text, { dimColor: true, children: ' cancel' })] })] }));
}
