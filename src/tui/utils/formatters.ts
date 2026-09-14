/** Shared formatting utilities */

export function fmtMem(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function fmtUptime(ms: number): string {
  if (!ms || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtDate(date?: Date): string {
  if (!date) return 'never';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function fmtTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

export function fmtElapsed(from: Date): string {
  const secs = Math.floor((Date.now() - from.getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m ${s}s`;
  return `${h}h ${m % 60}m`;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen <= 1) return '…';
  return str.slice(0, maxLen - 1) + '…';
}

export function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

const SPARK_CHARS = ' ▁▂▃▄▅▆▇█';
export { SPARK_CHARS };

export function sparkline(values: number[], width = 10): string {
  if (width <= 0) return '';
  if (!values.length) return ' '.repeat(width);
  const max = Math.max(...values, 1);
  const slice = values.slice(-width);
  const padded =
    slice.length < width
      ? [...Array(width - slice.length).fill(0), ...slice]
      : slice;
  return padded
    .map(
      (v) =>
        SPARK_CHARS[
          Math.min(
            Math.floor((v / max) * (SPARK_CHARS.length - 1)),
            SPARK_CHARS.length - 1
          )
        ]
    )
    .join('');
}
