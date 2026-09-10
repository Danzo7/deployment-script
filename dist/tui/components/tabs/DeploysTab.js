import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { DETAIL_W, fmtDate, truncate } from '../shared.js';
export function DeploysTab({ summary, deployCursor, scrollOffset, maxVisible, }) {
    const { app } = summary;
    const builds = app.builds ?? [];
    if (builds.length === 0) {
        return (_jsx(Box, { width: DETAIL_W, children: _jsx(Text, { dimColor: true, children: "No builds found." }) }));
    }
    const activeBuildIndex = app.activeBuild
        ? builds.findIndex((b) => b === app.activeBuild)
        : -1;
    const activeCommit = app.lastDeployedCommit;
    const activeDeployDate = app.lastDeploy;
    const visibleBuilds = builds.slice(scrollOffset, scrollOffset + maxVisible);
    return (_jsx(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, children: visibleBuilds.map((buildPath, visIdx) => {
            const idx = visIdx + scrollOffset;
            const isActive = idx === activeBuildIndex;
            const isCursor = idx === deployCursor;
            let shortHash, commitMsg, ageStr;
            if (isActive && activeCommit) {
                shortHash = activeCommit.hash.slice(0, 7);
                commitMsg = activeCommit.message;
                ageStr = fmtDate(activeDeployDate);
            }
            else {
                const base = buildPath
                    .replace(/[/\\]+$/, '')
                    .split(/[/\\]/)
                    .pop() ?? buildPath;
                shortHash = base.slice(0, 7);
                commitMsg = base;
                ageStr = '—';
            }
            const msgMaxLen = Math.max(10, DETAIL_W - (isCursor ? 2 : 0) - 30);
            return (_jsxs(Box, { flexDirection: "row", width: DETAIL_W, children: [isCursor ? (_jsx(Text, { bold: true, color: "yellow", children: "\u258C\u258C" })) : (_jsx(Text, { children: '  ' })), isActive ? (_jsxs(Text, { bold: true, color: "yellow", children: ["\u25CF", ' '] })) : (_jsx(Text, { dimColor: true, children: "\u25CB " })), _jsx(Text, { bold: true, color: "yellow", children: shortHash }), _jsx(Text, { children: " " }), isCursor ? (_jsx(Text, { bold: true, color: "yellow", children: truncate(commitMsg, msgMaxLen) })) : isActive ? (_jsx(Text, { children: truncate(commitMsg, msgMaxLen) })) : (_jsx(Text, { dimColor: true, children: truncate(commitMsg, msgMaxLen) })), isActive && _jsx(Text, { dimColor: true, children: " [active]" }), _jsxs(Text, { dimColor: true, children: [" ", ageStr] })] }, idx));
        }) }));
}
