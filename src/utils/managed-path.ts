import fs from 'fs';
import path from 'path';

export function validateResourceName(name: string): void {
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(name) ||
    name === '.' ||
    name === '..' ||
    name === '.detect-staging' ||
    name.endsWith('.') ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new Error(
      `Invalid resource name "${name}". Use letters, numbers, dots, hyphens, or underscores; directory and device names are not allowed.`
    );
  }
}

function resolveExistingParents(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    const parent = path.dirname(target);
    if (parent === target) throw err;
    return path.join(resolveExistingParents(parent), path.basename(target));
  }
}

/** Require a strict descendant, checking existing symlinks/junctions as well. */
export function assertManagedPath(target: string, base: string): void {
  const within = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return (
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative)
    );
  };
  const resolvedTarget = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (
    !within(resolvedTarget, resolvedBase) ||
    !within(
      resolveExistingParents(resolvedTarget),
      resolveExistingParents(resolvedBase)
    )
  ) {
    throw new Error(
      `Refusing path outside managed directory "${base}": ${target}`
    );
  }
}

/** Application directories must not contain, or live inside, shared storage. */
export function assertSeparatePaths(first: string, second: string): void {
  const related = (a: string, b: string) => {
    const relative = path.relative(a, b);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith('..' + path.sep) &&
        !path.isAbsolute(relative))
    );
  };
  const a = resolveExistingParents(path.resolve(first));
  const b = resolveExistingParents(path.resolve(second));
  if (related(a, b) || related(b, a)) {
    throw new Error(
      `Application and shared storage directories must not overlap: ${first}, ${second}`
    );
  }
}

/** Validate the link's parent, without following the link into persistent storage. */
export function storageLinkPath(buildDir: string, linkName: string): string {
  // eslint-disable-next-line no-control-regex
  const invalidCharacters = /[:\x00-\x1f]/;
  if (
    !linkName ||
    invalidCharacters.test(linkName) ||
    path.isAbsolute(linkName) ||
    linkName.split(/[\\/]/).some((part) => part === '..' || part === '.')
  ) {
    throw new Error(`Invalid storage link name: ${linkName}`);
  }
  const linkPath = path.resolve(buildDir, linkName);
  const relative = path.relative(path.resolve(buildDir), linkPath);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Storage link escapes build directory: ${linkName}`);
  }
  const parent = path.dirname(linkPath);
  if (parent !== path.resolve(buildDir)) assertManagedPath(parent, buildDir);
  return linkPath;
}
