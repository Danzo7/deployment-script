import { format, formatDistanceToNow } from "date-fns";
const DATE_TIME_FORMAT = "yyyy-MM-dd HH:mm:ss";
function formatDate(date, fallback = "\u2014") {
  if (!date) return fallback;
  return format(new Date(date), DATE_TIME_FORMAT);
}
function formatRelative(date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}
function toISO(date) {
  return date ? new Date(date).toISOString() : (/* @__PURE__ */ new Date()).toISOString();
}
function nowTimeString() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString();
}
export {
  formatDate,
  formatRelative,
  nowTimeString,
  toISO
};
