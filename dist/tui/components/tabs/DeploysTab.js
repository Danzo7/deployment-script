import { jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { DETAIL_W, fmtDate, truncate } from "../shared.js";
function DeploysTab({
  summary,
  deployCursor,
  scrollOffset,
  maxVisible
}) {
  const { app } = summary;
  const builds = app.builds ?? [];
  if (builds.length === 0) {
    return /* @__PURE__ */ jsx(Box, { width: DETAIL_W, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: "No builds found." }) });
  }
  const activeBuildIndex = app.activeBuild ? builds.findIndex((b) => b === app.activeBuild) : -1;
  const activeCommit = app.lastDeployedCommit;
  const activeDeployDate = app.lastDeploy;
  const visibleBuilds = builds.slice(scrollOffset, scrollOffset + maxVisible);
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", width: DETAIL_W, height: maxVisible, children: visibleBuilds.map((buildPath, visIdx) => {
    const idx = visIdx + scrollOffset;
    const isActive = idx === activeBuildIndex;
    const isCursor = idx === deployCursor;
    let shortHash, commitMsg, ageStr;
    if (isActive && activeCommit) {
      shortHash = activeCommit.hash.slice(0, 7);
      commitMsg = activeCommit.message;
      ageStr = fmtDate(activeDeployDate);
    } else {
      const base = buildPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? buildPath;
      shortHash = base.slice(0, 7);
      commitMsg = base;
      ageStr = "\u2014";
    }
    const msgMaxLen = Math.max(10, DETAIL_W - (isCursor ? 2 : 0) - 30);
    return /* @__PURE__ */ jsxs(Box, { flexDirection: "row", width: DETAIL_W, children: [
      isCursor ? /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "\u258C\u258C" }) : /* @__PURE__ */ jsx(Text, { children: "  " }),
      isActive ? /* @__PURE__ */ jsxs(Text, { bold: true, color: "yellow", children: [
        "\u25CF",
        " "
      ] }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u25CB " }),
      /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: shortHash }),
      /* @__PURE__ */ jsx(Text, { children: " " }),
      isCursor ? /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: truncate(commitMsg, msgMaxLen) }) : isActive ? /* @__PURE__ */ jsx(Text, { children: truncate(commitMsg, msgMaxLen) }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: truncate(commitMsg, msgMaxLen) }),
      isActive && /* @__PURE__ */ jsx(Text, { dimColor: true, children: " [active]" }),
      /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
        " ",
        ageStr
      ] })
    ] }, idx);
  }) });
}
export {
  DeploysTab
};
