/** Shared utilities for TUI editors (Env and Header) */

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + '…';
}

export function countChanges<T extends { state: string }>(rows: T[]) {
  let modified = 0,
    added = 0,
    deleted = 0;
  for (const r of rows) {
    if (r.state === 'modified') modified++;
    else if (r.state === 'new') added++;
    else if (r.state === 'deleted') deleted++;
  }
  return { modified, added, deleted, total: modified + added + deleted };
}

// Environment variable validation
const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_KEYWORDS = /SECRET|KEY|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE/i;

export function isValidEnvKey(key: string): boolean {
  return KEY_REGEX.test(key);
}

export function isSecret(key: string, value: string): boolean {
  if (SECRET_KEYWORDS.test(key)) return true;
  // high-entropy heuristic: long string, mostly non-space printable chars
  if (
    value.length > 20 &&
    !/\s/.test(value) &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value)
  ) {
    return true;
  }
  return false;
}

export function maskValue(value: string): string {
  if (value.length <= 4) return '••••••••';
  return '••••••••' + value.slice(-4);
}
