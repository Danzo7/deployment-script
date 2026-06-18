import type { Domain, Route } from '../db/model.js';

/**
 * The proxy_set_header directives emitted in every location block.
 * These are compiler-owned and NOT user-modifiable via CLI.
 * Edit this list in code to add/remove/change proxy headers globally.
 *
 * Each entry is [headerName, nginxValue].
 */
export const PROXY_SET_HEADERS: [string, string][] = [
  ['Host', '$host'],
  ['X-Real-IP', '$remote_addr'],
  ['X-Forwarded-For', '$proxy_add_x_forwarded_for'],
  ['X-Forwarded-Proto', '$scheme'],
  ['X-Forwarded-Host', '$host'],
];

/**
 * The default add_header directives — layer 1 of the three-layer merge.
 * Users CAN override these via `dm domain set-header` / `dm route set-header`.
 * HSTS is excluded here; it is injected conditionally by mergeHeaders when isSsl=true.
 *
 * Edit this list in code to change the default security header baseline.
 */
export const DEFAULT_ADD_HEADERS: [string, string][] = [
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
];

/**
 * HSTS header — added to the merge result only when isSsl is true.
 * Never emitted over plain HTTP.
 */
export const HSTS_HEADER: [string, string] = [
  'Strict-Transport-Security',
  'max-age=63072000; includeSubDomains',
];


/**
 * Validates a user-supplied header key. Throws with a descriptive message on failure.
 *
 * Rules:
 *   - printable ASCII only (code points 0x21–0x7E), no whitespace, no colon
 *   - must not match (case-insensitively) any key in PROXY_SET_HEADERS — those are
 *     compiler-owned request-direction headers, not user-settable response headers
 *
 * NOTE: Keys from DEFAULT_ADD_HEADERS (X-Frame-Options, X-Content-Type-Options,
 * Referrer-Policy, Strict-Transport-Security) are explicitly ALLOWED — overriding
 * those is the entire purpose of the three-layer merge.
 */
export function validateHeaderKey(key: string): void {
  // Must be non-empty printable ASCII (0x21–0x7E), no whitespace, no colon
  if (!/^[\x21-\x7E]+$/.test(key) || /[\s:]/.test(key)) {
    throw new Error(`"${key}" is not a valid HTTP header name`);
  }

  // Must not be a compiler-owned proxy_set_header key
  const keyLower = key.toLowerCase();
  const blocked = PROXY_SET_HEADERS.find(([name]) => name.toLowerCase() === keyLower);
  if (blocked) {
    throw new Error(
      `Header "${key}" is managed by the proxy configuration and cannot be set`
    );
  }
}

/**
 * Produces the final merged add_header map for a location block.
 *
 * Layer order — later layers win on collision. Collision detection is CASE-INSENSITIVE
 * (HTTP header names are case-insensitive by spec), but the winning layer's original
 * casing is preserved in the output key. This prevents a user setting "x-frame-options"
 * (lowercase) and "X-Frame-Options" (default) from both being emitted as two separate
 * add_header lines.
 *
 *   1. DEFAULT_ADD_HEADERS (+ HSTS_HEADER when isSsl=true)  — lowest priority
 *   2. domain.headers (may be undefined — treated as empty)
 *   3. route.headers (may be undefined — treated as empty)   — highest priority
 *
 * Returns a new object; never mutates inputs.
 */
export function mergeHeaders(
  domain: Domain,
  route: Route,
  isSsl: boolean
): Record<string, string> {
  // result maps lowercased key → [originalCasedKey, value]
  const merged = new Map<string, [string, string]>();

  // Layer 1: DEFAULT_ADD_HEADERS (always) + HSTS_HEADER (when isSsl)
  const baseHeaders: [string, string][] = isSsl
    ? [...DEFAULT_ADD_HEADERS, HSTS_HEADER]
    : [...DEFAULT_ADD_HEADERS];

  for (const [key, value] of baseHeaders) {
    merged.set(key.toLowerCase(), [key, value]);
  }

  // Layer 2: domain.headers (higher priority — overwrites layer 1)
  const domainHeaders = domain.headers ?? {};
  for (const [key, value] of Object.entries(domainHeaders)) {
    merged.set(key.toLowerCase(), [key, value]);
  }

  // Layer 3: route.headers (highest priority — overwrites layers 1 and 2)
  const routeHeaders = route.headers ?? {};
  for (const [key, value] of Object.entries(routeHeaders)) {
    merged.set(key.toLowerCase(), [key, value]);
  }

  // Build the output object preserving the winning layer's original casing
  const result: Record<string, string> = {};
  for (const [originalKey, value] of merged.values()) {
    result[originalKey] = value;
  }
  return result;
}
