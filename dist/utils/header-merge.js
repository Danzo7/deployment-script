const PROXY_SET_HEADERS = [
  ["Host", "$host"],
  ["X-Real-IP", "$remote_addr"],
  ["X-Forwarded-For", "$proxy_add_x_forwarded_for"],
  ["X-Forwarded-Proto", "$scheme"],
  ["X-Forwarded-Host", "$host"]
];
const DEFAULT_ADD_HEADERS = [
  ["X-Frame-Options", "SAMEORIGIN"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"]
];
const HSTS_HEADER = [
  "Strict-Transport-Security",
  "max-age=63072000; includeSubDomains"
];
function validateHeaderKey(key) {
  if (!/^[\x21-\x7E]+$/.test(key) || /[\s:]/.test(key)) {
    throw new Error(`"${key}" is not a valid HTTP header name`);
  }
  const keyLower = key.toLowerCase();
  const blocked = PROXY_SET_HEADERS.find(
    ([name]) => name.toLowerCase() === keyLower
  );
  if (blocked) {
    throw new Error(
      `Header "${key}" is managed by the proxy configuration and cannot be set`
    );
  }
}
function mergeHeaders(domain, route, isSsl) {
  const merged = /* @__PURE__ */ new Map();
  const baseHeaders = isSsl ? [...DEFAULT_ADD_HEADERS, HSTS_HEADER] : [...DEFAULT_ADD_HEADERS];
  for (const [key, value] of baseHeaders) {
    merged.set(key.toLowerCase(), [key, value]);
  }
  const domainHeaders = domain.headers ?? {};
  for (const [key, value] of Object.entries(domainHeaders)) {
    merged.set(key.toLowerCase(), [key, value]);
  }
  const routeHeaders = route.headers ?? {};
  for (const [key, value] of Object.entries(routeHeaders)) {
    merged.set(key.toLowerCase(), [key, value]);
  }
  const result = {};
  for (const [originalKey, value] of merged.values()) {
    result[originalKey] = value;
  }
  return result;
}
export {
  DEFAULT_ADD_HEADERS,
  HSTS_HEADER,
  PROXY_SET_HEADERS,
  mergeHeaders,
  validateHeaderKey
};
