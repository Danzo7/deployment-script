/** Quote one Nginx argument. Variables retain their existing Nginx semantics. */
export function quoteNginxArgument(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(
      'Nginx values cannot contain control characters or newlines'
    );
  }
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function validateRoutePath(value: string): void {
  if (
    value.length > 2048 ||
    !/^[a-zA-Z0-9._~%/@:+,-]*$/.test(value) ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid route path: ${value}`);
  }
}
