import { jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { TERM_W } from "./shared.js";
function ConfirmDialog({
  title,
  description
}) {
  return /* @__PURE__ */ jsxs(
    Box,
    {
      flexDirection: "column",
      alignSelf: "center",
      width: Math.min(50, TERM_W - 4),
      borderStyle: "round",
      borderColor: "red",
      children: [
        /* @__PURE__ */ jsx(Text, { color: "red", children: title }),
        /* @__PURE__ */ jsx(Text, { children: description }),
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", children: [
          /* @__PURE__ */ jsx(Text, { bold: true, color: "white", children: "y" }),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: " confirm  " }),
          /* @__PURE__ */ jsx(Text, { bold: true, color: "white", children: "n" }),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: " cancel" })
        ] })
      ]
    }
  );
}
export {
  ConfirmDialog
};
