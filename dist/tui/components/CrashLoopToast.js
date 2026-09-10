import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { Box, Text } from "ink";
import { TERM_W, TOAST_TTL_TICKS } from "./shared.js";
function CrashLoopToast({
  appName,
  restartCount,
  tickCount,
  onDismiss
}) {
  useEffect(() => {
    if (tickCount >= TOAST_TTL_TICKS) onDismiss();
  }, [tickCount, onDismiss]);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "row", width: TERM_W, children: [
    /* @__PURE__ */ jsx(Text, { color: "yellow", children: "\u258C \u26A0 " }),
    /* @__PURE__ */ jsxs(Text, { children: [
      appName,
      " has restarted ",
      restartCount,
      " ",
      restartCount === 1 ? "time" : "times"
    ] }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: " L to view logs" })
  ] });
}
export {
  CrashLoopToast
};
