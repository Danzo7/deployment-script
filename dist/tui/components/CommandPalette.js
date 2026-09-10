import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { TERM_W } from "./shared.js";
const PALETTE_VERBS = [
  "restart",
  "stop",
  "deploy",
  "logs",
  "env",
  "rollback"
];
function parsePaletteInput(input, appNames) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return null;
  const verb = trimmed.slice(0, spaceIdx).toLowerCase();
  const appName = trimmed.slice(spaceIdx + 1).trim();
  if (!appName || !PALETTE_VERBS.includes(verb))
    return null;
  const matched = appNames.find(
    (n) => n.toLowerCase() === appName.toLowerCase()
  );
  if (!matched) return null;
  return { type: verb, appName: matched };
}
function getPaletteSuggestions(input, appNames) {
  const query = input.toLowerCase().trim();
  const all = [];
  for (const verb of PALETTE_VERBS)
    for (const name of appNames) all.push(`${verb} ${name}`);
  if (!query) return all.slice(0, 5);
  const sw = all.filter((s) => s.toLowerCase().startsWith(query));
  if (sw.length >= 5) return sw.slice(0, 5);
  const contains = all.filter(
    (s) => s.toLowerCase().includes(query) && !s.toLowerCase().startsWith(query)
  );
  return [...sw, ...contains].slice(0, 5);
}
function CommandPalette({
  input,
  appNames
}) {
  const paletteWidth = Math.min(60, TERM_W - 4);
  const suggestions = getPaletteSuggestions(input, appNames);
  return /* @__PURE__ */ jsxs(
    Box,
    {
      flexDirection: "column",
      alignSelf: "center",
      width: paletteWidth,
      borderStyle: "round",
      borderColor: "yellow",
      children: [
        /* @__PURE__ */ jsxs(Box, { flexDirection: "row", children: [
          /* @__PURE__ */ jsxs(Text, { children: [
            ": ",
            input
          ] }),
          /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "\u2588" })
        ] }),
        suggestions.map((s, i) => /* @__PURE__ */ jsx(Box, { flexDirection: "row", children: i === 0 ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs(Text, { bold: true, color: "yellow", children: [
            "\u25B6",
            " "
          ] }),
          /* @__PURE__ */ jsx(Text, { bold: true, color: "white", children: s })
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: "  " }),
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: s })
        ] }) }, s)),
        suggestions.length === 0 && /* @__PURE__ */ jsx(Text, { dimColor: true, children: " no matching commands" })
      ]
    }
  );
}
export {
  CommandPalette,
  getPaletteSuggestions,
  parsePaletteInput
};
