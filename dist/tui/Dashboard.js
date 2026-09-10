import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Dashboard.tsx — layout shell + input handler.
 * All data concerns live in launch-dashboard.tsx.
 * All presentational concerns live in src/tui/components/.
 */
import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { TopBar } from './components/TopBar.js';
import { FilterBar } from './components/FilterBar.js';
import { AppList } from './components/AppList.js';
import { Keybar } from './components/Keybar.js';
import { CommandPalette, parsePaletteInput, getPaletteSuggestions, } from './components/CommandPalette.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { CrashLoopToast } from './components/CrashLoopToast.js';
import { OverviewTab } from './components/tabs/OverviewTab.js';
import { MetricsTab } from './components/tabs/MetricsTab.js';
import { LogsTab } from './components/tabs/LogsTab.js';
import { DeploysTab } from './components/tabs/DeploysTab.js';
import { DomainsTab } from './components/tabs/DomainsTab.js';
import { TERM_W, LIST_W, DETAIL_W, DETAIL_H, statusColor, healthColor, truncate, } from './components/shared.js';
// ─── TabBar (local, tiny) ─────────────────────────────────────────────────────
const TAB_KEYS = [
    'overview',
    'metrics',
    'logs',
    'deploys',
    'domains',
];
const TAB_LABELS = ['Overview', 'Metrics', 'Logs', 'Deploys', 'Domains'];
function TabBar({ active }) {
    const texts = TAB_LABELS.map((l) => ` ${l} `);
    const fill = Math.max(0, DETAIL_W - texts.reduce((s, t) => s + t.length, 0));
    return (_jsxs(Box, { flexDirection: "row", width: DETAIL_W, children: [TAB_KEYS.map((k, i) => k === active ? (_jsx(Box, { children: _jsx(Text, { bold: true, color: "yellow", children: texts[i] }) }, k)) : (_jsx(Box, { children: _jsx(Text, { dimColor: true, children: texts[i] }) }, k))), fill > 0 && _jsx(Text, { dimColor: true, children: '─'.repeat(fill) })] }));
}
// ─── DetailHeader (local, tiny) ───────────────────────────────────────────────
function DetailHeader({ summary, }) {
    if (!summary)
        return (_jsx(Box, { width: DETAIL_W, children: _jsx(Text, { dimColor: true, children: "Select an app\u2026" }) }));
    const status = summary.pm2?.status ?? 'not-found';
    const hColor = healthColor(summary.health);
    const badge = {
        healthy: '[HEALTHY]',
        degraded: '[DEGRADED]',
        down: '[DOWN]',
    }[summary.health] ?? '[UNKNOWN]';
    return (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: DETAIL_W, children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { bold: true, color: "white", children: truncate(summary.app.name, Math.floor(DETAIL_W * 0.5)) }), _jsx(Text, { color: statusColor(status), children: status })] }), _jsx(Text, { color: hColor, children: badge })] }));
}
// ─── Dashboard ────────────────────────────────────────────────────────────────
export function Dashboard(props) {
    const { exit } = useApp();
    const [cursor, setCursor] = useState(0);
    const [tab, setTab] = useState('overview');
    const [metricsView, setMetricsView] = useState('stats');
    const [actionMode, setActionMode] = useState('none');
    const [cmdInput, setCmdInput] = useState('');
    const [filterQuery, setFilterQuery] = useState('');
    const [filterActive, setFilterActive] = useState(false);
    const [deployCursor, setDeployCursor] = useState(0);
    const [toastAppName, setToastAppName] = useState(null);
    const [toastTick, setToastTick] = useState(0);
    const [tabScrollOffset, setTabScrollOffset] = useState(0);
    const cpuHistories = useRef(new Map());
    const memHistories = useRef(new Map());
    const summaries = props.globalState?.summaries ?? [];
    const filteredSummaries = filterQuery.trim()
        ? summaries.filter((s) => s.app.name.toLowerCase().includes(filterQuery.toLowerCase()))
        : summaries;
    const selectedSummary = filteredSummaries[cursor] ?? null;
    const appNames = summaries.map((s) => s.app.name);
    // Notify parent which app is selected so it can fetch detail
    const prevSelectedName = useRef(null);
    useEffect(() => {
        const name = selectedSummary?.app.name ?? null;
        if (name !== prevSelectedName.current) {
            prevSelectedName.current = name;
            props.onSelectApp(name);
            // If logs tab is open, notify so parent can reload logs for new app
            if (tab === 'logs')
                props.onLogsTabActive(true);
        }
    }, [selectedSummary?.app.name]);
    // Sparkline history — update on every global tick
    useEffect(() => {
        for (const s of summaries) {
            const name = s.app.name;
            const cpu = s.pm2?.cpu ?? 0;
            const mem = s.pm2?.memBytes ?? 0;
            cpuHistories.current.set(name, [...(cpuHistories.current.get(name) ?? []), cpu].slice(-30));
            memHistories.current.set(name, [...(memHistories.current.get(name) ?? []), mem / 1024 / 1024].slice(-30));
        }
    }, [props.globalState?.tickCount]);
    // Cursor bounds
    useEffect(() => {
        if (cursor >= filteredSummaries.length && filteredSummaries.length > 0) {
            setCursor(filteredSummaries.length - 1);
        }
    }, [filteredSummaries.length]);
    // Reset scroll and deploy cursor when selection/tab changes
    useEffect(() => {
        setDeployCursor(0);
    }, [selectedSummary?.app.name]);
    useEffect(() => {
        setTabScrollOffset(0);
        setMetricsView('stats');
    }, [tab, selectedSummary?.app.name]);
    // Crash-loop toast
    useEffect(() => {
        if (!toastAppName) {
            const looping = summaries.find((s) => s.restartDelta >= 3);
            if (looping) {
                setToastAppName(looping.app.name);
                setToastTick(0);
            }
        }
        if (toastAppName)
            setToastTick((t) => t + 1);
    }, [props.globalState?.tickCount]);
    const TABS = TAB_KEYS;
    useInput((input, key) => {
        if (toastAppName && key.escape) {
            setToastAppName(null);
            setToastTick(0);
            return;
        }
        if (actionMode === 'cmd-palette') {
            if (key.escape) {
                setActionMode('none');
                setCmdInput('');
            }
            else if (key.tab)
                setCmdInput(getPaletteSuggestions(cmdInput, appNames)[0] ?? cmdInput);
            else if (key.return) {
                const p = parsePaletteInput(cmdInput, appNames);
                if (p)
                    props.onAction(p);
                setActionMode('none');
                setCmdInput('');
            }
            else if (key.backspace || key.delete)
                setCmdInput((s) => s.slice(0, -1));
            else if (input.length === 1 && input >= ' ')
                setCmdInput((s) => s + input);
            return;
        }
        if (actionMode === 'confirm-restart' ||
            actionMode === 'confirm-stop' ||
            actionMode === 'confirm-rollback') {
            if (input === 'y' || key.return) {
                if (selectedSummary) {
                    if (actionMode === 'confirm-restart')
                        props.onAction({
                            type: 'restart',
                            appName: selectedSummary.app.name,
                        });
                    else if (actionMode === 'confirm-stop')
                        props.onAction({ type: 'stop', appName: selectedSummary.app.name });
                    else if (actionMode === 'confirm-rollback') {
                        const activeIdx = selectedSummary.app.builds?.findIndex((b) => b === selectedSummary.app.activeBuild) ?? -1;
                        if (deployCursor !== activeIdx)
                            props.onAction({
                                type: 'rollback',
                                appName: selectedSummary.app.name,
                                rollbackIndex: deployCursor,
                            });
                    }
                }
                setActionMode('none');
            }
            else if (input === 'n' || key.escape)
                setActionMode('none');
            return;
        }
        if (filterActive) {
            if (key.escape) {
                setFilterQuery('');
                setFilterActive(false);
            }
            else if (key.backspace || key.delete)
                setFilterQuery((s) => s.slice(0, -1));
            else if (input.length === 1 && input >= ' ')
                setFilterQuery((s) => s + input);
            return;
        }
        if (input === '/') {
            if (tab !== 'logs')
                setFilterActive(true);
        }
        else if (input === ':')
            setActionMode('cmd-palette');
        else if (input === 'q') {
            props.onQuit();
            exit();
        }
        else if (key.upArrow || input === 'k') {
            if (tab === 'deploys')
                setDeployCursor((d) => Math.max(0, d - 1));
            else
                setCursor((c) => Math.max(0, c - 1));
        }
        else if (key.downArrow || input === 'j') {
            if (tab === 'deploys')
                setDeployCursor((d) => Math.min((selectedSummary?.app.builds?.length ?? 1) - 1, d + 1));
            else
                setCursor((c) => Math.min(filteredSummaries.length - 1, c + 1));
        }
        else if (key.tab || input === 'l') {
            setTab((t) => {
                const next = TABS[(TABS.indexOf(t) + 1) % TABS.length];
                props.onLogsTabActive(next === 'logs');
                return next;
            });
            setTabScrollOffset(0);
        }
        else if (input === 'h') {
            setTab((t) => {
                const next = TABS[(TABS.indexOf(t) - 1 + TABS.length) % TABS.length];
                props.onLogsTabActive(next === 'logs');
                return next;
            });
            setTabScrollOffset(0);
        }
        else if (key.pageUp) {
            const pageSize = Math.max(1, Math.floor(DETAIL_H / 2));
            setTabScrollOffset((o) => {
                const next = o + pageSize;
                // Clamp: max offset is total lines minus the visible rows (so at least 1 line shows)
                if (tab === 'logs') {
                    const contentRows = Math.max(1, DETAIL_H - 1);
                    const maxOffset = Math.max(0, props.logLines.length - contentRows);
                    return Math.min(next, maxOffset);
                }
                // For metrics nginx logs and other tabs we can't easily know the total here,
                // but we still prevent runaway by capping at a generous but finite value.
                // The tab components also clamp internally.
                return next;
            });
        }
        else if (key.pageDown) {
            setTabScrollOffset((o) => Math.max(0, o - Math.max(1, Math.floor(DETAIL_H / 2))));
        }
        else if (input === 'r') {
            if (selectedSummary)
                setActionMode('confirm-restart');
        }
        else if (input === 'S') {
            if (selectedSummary)
                setActionMode('confirm-stop');
        }
        else if (input === 'D') {
            if (selectedSummary)
                props.onAction({ type: 'deploy', appName: selectedSummary.app.name });
        }
        else if (input === 'E') {
            if (selectedSummary)
                props.onAction({ type: 'env', appName: selectedSummary.app.name });
        }
        else if (input === 'L') {
            if (selectedSummary)
                props.onAction({ type: 'logs', appName: selectedSummary.app.name });
        }
        else if (input === 'X' && tab === 'logs') {
            props.onClearLogs();
        }
        else if (input === 'v' && tab === 'metrics') {
            setMetricsView((v) => (v === 'stats' ? 'logs' : 'stats'));
            setTabScrollOffset(0);
        }
        else if (key.return && tab === 'deploys') {
            if (selectedSummary) {
                const activeIdx = selectedSummary.app.builds?.findIndex((b) => b === selectedSummary.app.activeBuild) ?? -1;
                if (deployCursor !== activeIdx)
                    setActionMode('confirm-rollback');
            }
        }
        else if (key.return && tab === 'domains') {
            if (selectedSummary)
                props.onAction({
                    type: 'view-nginx-config',
                    appName: selectedSummary.app.name,
                });
        }
    });
    // ── Render ────────────────────────────────────────────────────────────────
    if (props.loading || !props.globalState) {
        return (_jsx(Box, { flexDirection: "column", width: TERM_W, children: _jsx(Text, { dimColor: true, children: "Loading\u2026" }) }));
    }
    const { pm2Reachable, dbReachable, sshReachable, sshHost, totalMemBytes } = props.globalState;
    const cpuHistory = cpuHistories.current.get(selectedSummary?.app.name ?? '') ?? [];
    const memHistory = memHistories.current.get(selectedSummary?.app.name ?? '') ?? [];
    const overlayActive = actionMode !== 'none';
    return (_jsxs(Box, { flexDirection: "column", width: TERM_W, children: [_jsx(TopBar, { pm2Reachable: pm2Reachable, dbReachable: dbReachable, sshReachable: sshReachable, sshHost: sshHost }), _jsx(FilterBar, { active: filterActive, query: filterQuery }), toastAppName && (_jsx(CrashLoopToast, { appName: toastAppName, restartCount: summaries.find((s) => s.app.name === toastAppName)?.restartDelta ??
                    0, tickCount: toastTick, onDismiss: () => {
                    setToastAppName(null);
                    setToastTick(0);
                } })), _jsxs(Box, { flexDirection: "row", width: TERM_W, children: [_jsx(Box, { flexDirection: "column", width: LIST_W, children: _jsx(AppList, { summaries: filteredSummaries, cursor: cursor }) }), _jsx(Box, { flexDirection: "column", width: 1, children: _jsx(Text, { dimColor: true, children: "\u2502" }) }), _jsx(Box, { flexDirection: "column", width: DETAIL_W, children: selectedSummary ? (_jsxs(_Fragment, { children: [_jsx(DetailHeader, { summary: selectedSummary }), _jsx(TabBar, { active: tab }), tab === 'overview' && (_jsx(OverviewTab, { summary: selectedSummary, detail: props.appDetail })), tab === 'metrics' && (_jsx(MetricsTab, { summary: selectedSummary, detail: props.appDetail, cpuHistory: cpuHistory, memHistory: memHistory, totalMemBytes: totalMemBytes, scrollOffset: tabScrollOffset, maxVisible: DETAIL_H, metricsView: metricsView })), tab === 'logs' && (_jsx(LogsTab, { logLines: props.logLines, scrollOffset: tabScrollOffset, maxVisible: DETAIL_H })), tab === 'deploys' && (_jsx(DeploysTab, { summary: selectedSummary, deployCursor: deployCursor, onAction: props.onAction, scrollOffset: tabScrollOffset, maxVisible: DETAIL_H })), tab === 'domains' && (_jsx(DomainsTab, { detail: props.appDetail, maxVisible: DETAIL_H }))] })) : (_jsx(Box, { width: DETAIL_W, height: DETAIL_H, children: _jsx(Text, { dimColor: true, children: "No apps found." }) })) })] }), _jsx(Keybar, { activeTab: tab }), overlayActive && (_jsxs(Box, { flexDirection: "column", alignItems: "center", width: TERM_W, marginTop: 1, children: [actionMode === 'cmd-palette' && (_jsx(CommandPalette, { input: cmdInput, appNames: appNames })), actionMode === 'confirm-restart' && selectedSummary && (_jsx(ConfirmDialog, { title: "Restart app", description: `Restart ${selectedSummary.app.name}?` })), actionMode === 'confirm-stop' && selectedSummary && (_jsx(ConfirmDialog, { title: "Stop app", description: `Stop ${selectedSummary.app.name}?` })), actionMode === 'confirm-rollback' && selectedSummary && (_jsx(ConfirmDialog, { title: "Rollback", description: `Roll back ${selectedSummary.app.name} to build ${deployCursor}?` }))] }))] }));
}
