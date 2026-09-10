import fs from "fs";
import { validateSafeDomainName } from "./security-validation.js";
function captureFileSnapshot(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    const isSymlink = stats.isSymbolicLink();
    if (isSymlink) {
      const target = fs.readlinkSync(filePath);
      return {
        path: filePath,
        existed: true,
        isSymlink: true,
        target
      };
    } else {
      const content = fs.readFileSync(filePath);
      return {
        path: filePath,
        existed: true,
        content
      };
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        path: filePath,
        existed: false
      };
    }
    throw err;
  }
}
function normalizeDomainFilename(domainName) {
  validateSafeDomainName(domainName);
  return domainName.replace(/\./g, "_");
}
function constructSitesAvailablePath(domainName) {
  const filename = normalizeDomainFilename(domainName);
  return `/etc/nginx/sites-available/${filename}.conf`;
}
function constructSitesEnabledPath(domainName) {
  const filename = normalizeDomainFilename(domainName);
  return `/etc/nginx/sites-enabled/${filename}.conf`;
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function buildRollbackTargets(snapshot, paths) {
  const targets = [
    { label: "symlink", path: paths.symlinkPath, snapshot: snapshot.symlink },
    {
      label: "config file",
      path: paths.configPath,
      snapshot: snapshot.configFile
    }
  ];
  if (snapshot.certs && paths.certPath && paths.keyPath) {
    targets.push(
      {
        label: "certificate",
        path: paths.certPath,
        snapshot: snapshot.certs.cert
      },
      {
        label: "private key",
        path: paths.keyPath,
        snapshot: snapshot.certs.key
      }
    );
  }
  return targets;
}
export {
  buildRollbackTargets,
  captureFileSnapshot,
  constructSitesAvailablePath,
  constructSitesEnabledPath,
  normalizeDomainFilename,
  shellQuote
};
