import { jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { TERM_W } from "./shared.js";
function FilterBar({
  active,
  query
}) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "row", justifyContent: "space-between", width: TERM_W, children: [
    active ? /* @__PURE__ */ jsxs(Text, { children: [
      query,
      /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "\u2588" })
    ] }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: "filter apps\u2026" }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "/ search  : command  s sort" })
  ] });
}
export {
  FilterBar
};
