const TERM_W = Math.max(process.stdout.columns ?? 120, 80);
const TERM_H = Math.max(process.stdout.rows ?? 30, 20);
const LIST_W = Math.max(20, Math.min(32, Math.floor(TERM_W * 0.28)));
const DETAIL_W = TERM_W - LIST_W - 3;
const DETAIL_H = Math.max(5, TERM_H - 8);
const TOAST_TTL_TICKS = 10;
function statusColor(status) {
  switch (status) {
    case "online":
      return "green";
    case "errored":
    case "error":
      return "red";
    case "stopped":
    case "stopping":
      return "yellow";
    default:
      return "gray";
  }
}
function statusDot(_status) {
  return "\u25CF";
}
function healthColor(health) {
  switch (health) {
    case "healthy":
      return "green";
    case "degraded":
      return "yellow";
    case "down":
      return "red";
    default:
      return "gray";
  }
}
function fmtMem(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
function fmtUptime(ms) {
  if (!ms || ms < 0) return "-";
  const s = Math.floor(ms / 1e3);
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600);
  const m = Math.floor(s % 3600 / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtDate(date) {
  if (!date) return "never";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1e3);
  if (s < 60) return "just now";
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  if (maxLen <= 1) return "\u2026";
  return str.slice(0, maxLen - 1) + "\u2026";
}
function pad(str, len) {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}
const SPARK_CHARS = " \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
function sparkline(values, width = 10) {
  if (width <= 0) return "";
  if (!values.length) return " ".repeat(width);
  const max = Math.max(...values, 1);
  const slice = values.slice(-width);
  const padded = slice.length < width ? [...Array(width - slice.length).fill(0), ...slice] : slice;
  return padded.map(
    (v) => SPARK_CHARS[Math.min(
      Math.floor(v / max * (SPARK_CHARS.length - 1)),
      SPARK_CHARS.length - 1
    )]
  ).join("");
}
export {
  DETAIL_H,
  DETAIL_W,
  LIST_W,
  SPARK_CHARS,
  TERM_H,
  TERM_W,
  TOAST_TTL_TICKS,
  fmtDate,
  fmtMem,
  fmtUptime,
  healthColor,
  pad,
  sparkline,
  statusColor,
  statusDot,
  truncate
};
