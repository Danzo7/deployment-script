function normalizeDomainName(s) {
  let result = s;
  result = result.replace(/^https?:\/\//i, "");
  result = result.toLowerCase();
  result = result.replace(/\/+$/, "");
  return result;
}
function normalizePath(s) {
  let result = s.toLowerCase();
  result = result.replace(/\/+/g, "/");
  result = result.replace(/^\/+/, "");
  result = result.replace(/\/+$/, "");
  return result;
}
function validateHostname(s) {
  if (!s || s.length === 0) return false;
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = s.match(ipv4Pattern);
  if (ipv4Match) {
    return ipv4Match.slice(1).every((octet) => {
      const n = parseInt(octet, 10);
      return n >= 0 && n <= 255;
    });
  }
  const labels = s.split(".");
  if (labels.length === 0) return false;
  return labels.every((label) => {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[a-zA-Z0-9-]+$/.test(label);
  });
}
function assertPathUnique(routes, domainId, normalizedPath, domainName) {
  const existing = routes.find(
    (r) => r.domainId === domainId && r.path === normalizedPath
  );
  if (existing) {
    throw new Error(
      `Path "/${normalizedPath}" is already registered on domain "${domainName}"`
    );
  }
}
function assertAppUniqueOnDomain(routes, domainId, app, domainName) {
  const existing = routes.find(
    (r) => r.domainId === domainId && r.appId === app.id
  );
  if (existing) {
    throw new Error(
      `App "${app.name}" is already routed under domain "${domainName}"`
    );
  }
}
function assertAppNotRoutedElsewhere(routes, app, domains) {
  const existing = routes.find((r) => r.appId === app.id);
  if (existing) {
    const domain = domains.find((d) => d.id === existing.domainId);
    const domainName = domain ? domain.name : existing.domainId;
    const displayPath = existing.path === "" ? "/" : "/" + existing.path;
    throw new Error(
      `App "${app.name}" is already routed at ${domainName}${displayPath}. Use --force to add another route.`
    );
  }
}
export {
  assertAppNotRoutedElsewhere,
  assertAppUniqueOnDomain,
  assertPathUnique,
  normalizeDomainName,
  normalizePath,
  validateHostname
};
