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

export const DB_COLORS = {
  accent: '#3ad6e0',
  accentDim: '#1c4a50',
  panel: '#0a0e13',
  border: '#2c6b74',
  green: '#3fd77a',
  yellow: '#e0c341',
  red: '#e0555b',
  dim: '#5c6773',
  text: '#d8dee6',
};
