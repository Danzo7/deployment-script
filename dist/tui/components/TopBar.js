import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { TERM_W } from "./shared.js";
function TopBar({
  pm2Reachable,
  dbReachable,
  sshReachable,
  sshHost
}) {
  const [time, setTime] = useState(() => (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8));
  useEffect(() => {
    const id = setInterval(
      () => setTime((/* @__PURE__ */ new Date()).toTimeString().slice(0, 8)),
      1e3
    );
    return () => clearInterval(id);
  }, []);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: TERM_W, children: [
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: TERM_W, children: [
      /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 2, children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "dm" }),
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 0, children: [
          /* @__PURE__ */ jsx(Text, { color: pm2Reachable ? "green" : "red", children: "\u25CF" }),
          /* @__PURE__ */ jsx(Text, { children: " pm2" })
        ] }),
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 0, children: [
          /* @__PURE__ */ jsx(Text, { color: dbReachable ? "green" : "red", children: "\u25CF" }),
          /* @__PURE__ */ jsx(Text, { children: " db" })
        ] }),
        sshHost != null && /* @__PURE__ */ jsxs(Box, { flexDirection: "row", gap: 0, children: [
          /* @__PURE__ */ jsx(Text, { color: sshReachable ? "green" : "yellow", children: "\u25CF" }),
          /* @__PURE__ */ jsxs(Text, { children: [
            " ssh:",
            sshHost
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx(Text, { children: time })
    ] }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2500".repeat(TERM_W) })
  ] });
}
export {
  TopBar
};
