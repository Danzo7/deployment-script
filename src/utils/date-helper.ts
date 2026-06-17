import { format, formatDistanceToNow } from 'date-fns';

const DATE_TIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';

/**
 * Formats a date to 'yyyy-MM-dd HH:mm:ss'.
 * Accepts an ISO string, Date, or number. Returns `fallback` if no value given.
 */
export function formatDate(date?: string | Date | number, fallback = '—'): string {
  if (!date) return fallback;
  return format(new Date(date), DATE_TIME_FORMAT);
}

/**
 * Returns a relative time label (e.g. "2 days ago").
 */
export function formatRelative(date: string | Date | number): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/**
 * Returns an ISO string for now, or for a given date/string/number.
 */
export function toISO(date?: Date | string | number): string {
  return date ? new Date(date).toISOString() : new Date().toISOString();
}

/**
 * Returns the current local time as a string (e.g. "10:45:03 AM").
 */
export function nowTimeString(): string {
  return new Date().toLocaleTimeString();
}
