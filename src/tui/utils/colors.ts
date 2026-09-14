/** Shared color/status utilities */

export function statusColor(status: string): string {
  switch (status) {
    case 'online':
      return 'green';
    case 'errored':
    case 'error':
      return 'red';
    case 'stopped':
    case 'stopping':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function statusDot(_status: string): string {
  return '●';
}

export function healthColor(health: string): string {
  switch (health) {
    case 'healthy':
      return 'green';
    case 'degraded':
      return 'yellow';
    case 'down':
      return 'red';
    default:
      return 'gray';
  }
}

export function levelColor(level: 'info' | 'warn' | 'error' | 'success'): string {
  switch (level) {
    case 'success':
      return 'green';
    case 'warn':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'white';
  }
}
