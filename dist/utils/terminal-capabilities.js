import os from "os";
function windowsBuild() {
  if (process.platform !== "win32") return 0;
  const parts = os.release().split(".");
  return parseInt(parts[2] ?? "0", 10);
}
function detectSupportsUnicode() {
  if (process.env.WT_SESSION) return true;
  if (process.platform === "win32" && process.env.TERM_PROGRAM) return true;
  if (process.platform === "win32") return windowsBuild() >= 17763;
  return true;
}
const supportsUnicode = detectSupportsUnicode();
export {
  supportsUnicode
};
