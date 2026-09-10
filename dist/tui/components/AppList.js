import { jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import {
  LIST_W,
  TERM_H,
  statusColor,
  statusDot,
  fmtMem,
  truncate
} from "./shared.js";
function AppRow({ data, selected }) {
  const { app, pm2, restartDelta } = data;
  const status = pm2?.status ?? "not-found";
  const color = statusColor(status);
  const nameMaxLen = LIST_W - (selected ? 2 : 0) - 1 - 2 - (restartDelta >= 3 ? 2 : 0);
  const displayName = truncate(app.name, Math.max(nameMaxLen, 4));
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: LIST_W, children: [
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", width: LIST_W, children: [
      selected && /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "\u258C\u258C" }),
      /* @__PURE__ */ jsx(Text, { color, children: statusDot(status) }),
      /* @__PURE__ */ jsx(Box, { marginLeft: 1, children: selected ? /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: displayName }) : /* @__PURE__ */ jsx(Text, { children: displayName }) }),
      restartDelta >= 3 && /* @__PURE__ */ jsx(Text, { color: "yellow", children: " \u26A0" })
    ] }),
    /* @__PURE__ */ jsx(Box, { flexDirection: "row", width: LIST_W, marginLeft: selected ? 3 : 1, children: restartDelta >= 3 ? /* @__PURE__ */ jsx(Text, { color: "red", children: "restart loop" }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: pm2 ? `${pm2.cpu.toFixed(1)}%  ${fmtMem(pm2.memBytes)}` : "\u2014" }) })
  ] });
}
function AppList({
  summaries,
  cursor
}) {
  const availableLines = Math.max(TERM_H - 8, 4);
  const visibleCount = Math.floor(availableLines / 2);
  let viewOffset = 0;
  if (cursor >= visibleCount) viewOffset = cursor - visibleCount + 1;
  viewOffset = Math.min(
    viewOffset,
    Math.max(0, summaries.length - visibleCount)
  );
  const visible = summaries.slice(viewOffset, viewOffset + visibleCount);
  let online = 0, errored = 0, stopped = 0;
  for (const s of summaries) {
    const st = s.pm2?.status ?? "not-found";
    if (st === "online") online++;
    else if (st === "errored" || st === "error") errored++;
    else stopped++;
  }
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: LIST_W, children: [
    visible.map((s, i) => /* @__PURE__ */ jsx(
      AppRow,
      {
        data: s,
        selected: viewOffset + i === cursor
      },
      s.app.name
    )),
    visible.length < visibleCount && /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: Array.from({ length: visibleCount - visible.length }).map((_, i) => /* @__PURE__ */ jsx(Box, { height: 2 }, i)) }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 1, width: LIST_W, children: [
      /* @__PURE__ */ jsxs(Text, { color: "green", children: [
        online,
        " online"
      ] }),
      /* @__PURE__ */ jsxs(Text, { color: "red", children: [
        errored,
        " err"
      ] }),
      /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
        stopped,
        " stopped"
      ] })
    ] })
  ] });
}
export {
  AppList
};
