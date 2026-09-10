import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { TERM_W } from "./shared.js";
function Hint({ label, desc }) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(Text, { bold: true, color: "white", children: label }),
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: ` ${desc}  ` })
  ] });
}
function Keybar({ activeTab }) {
  const tabHints = (() => {
    switch (activeTab) {
      case "overview":
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Hint, { label: "r", desc: "restart" }),
          /* @__PURE__ */ jsx(Hint, { label: "S", desc: "stop" }),
          /* @__PURE__ */ jsx(Hint, { label: "D", desc: "redeploy" }),
          /* @__PURE__ */ jsx(Hint, { label: "E", desc: "env" })
        ] });
      case "metrics":
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Hint, { label: "v", desc: "toggle logs" }),
          /* @__PURE__ */ jsx(Hint, { label: "c", desc: "copy value" })
        ] });
      case "logs":
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Hint, { label: "X", desc: "clear" }),
          /* @__PURE__ */ jsx(Hint, { label: "c", desc: "copy line" })
        ] });
      case "deploys":
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Hint, { label: "\u21B5", desc: "rollback" }),
          /* @__PURE__ */ jsx(Hint, { label: "c", desc: "copy commit" })
        ] });
      case "domains":
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Hint, { label: "\u21B5", desc: "nginx config" }),
          /* @__PURE__ */ jsx(Hint, { label: "c", desc: "copy url" })
        ] });
    }
  })();
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: TERM_W, children: [
    /* @__PURE__ */ jsx(Text, { dimColor: true, children: "\u2500".repeat(TERM_W) }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "row", children: [
      /* @__PURE__ */ jsx(Hint, { label: "Tab", desc: "switch tab" }),
      /* @__PURE__ */ jsx(Hint, { label: "PgUp/PgDn", desc: "scroll" }),
      /* @__PURE__ */ jsx(Hint, { label: "Esc", desc: "dismiss" }),
      /* @__PURE__ */ jsx(Hint, { label: "q", desc: "quit" }),
      tabHints
    ] })
  ] });
}
export {
  Keybar
};
