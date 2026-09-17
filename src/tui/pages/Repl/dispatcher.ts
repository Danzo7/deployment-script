import chalk from 'chalk';
import fs from 'fs';
import { Logger } from '../../../utils/logger.js';
import { acquireLock, releaseLock } from '../../../utils/lock-utils.js';
import { REMOTE_AUDIT_LOG_PATH } from '../../../constants.js';
import {
  COMMANDS,
  CommandNode,
  LeafCommand,
  isGroup,
  resolveLeafArgs,
} from '../../../command-registry.js';

// ─── Tokeniser ────────────────────────────────────────────────────────────────
// Splits input respecting single/double quotes, e.g.:
//   set-env api KEY="hello world"  →  ['set-env', 'api', 'KEY=hello world']
export function tokenise(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (cur.length) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}

// ─── Option parser ────────────────────────────────────────────────────────────
export function parseTokens(
  tokens: string[],
  optionSpecs?: Record<
    string,
    { flag?: string; alias?: string; type: string }
  >
): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  const flagTypes = new Map<string, string>();
  if (optionSpecs) {
    for (const [key, spec] of Object.entries(optionSpecs)) {
      const flagName = spec.flag ?? key;
      flagTypes.set(flagName, spec.type);
      if (spec.alias) flagTypes.set(spec.alias, spec.type);
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const body = t.slice(2);
      if (body.includes('=')) {
        const [k, ...rest] = body.split('=');
        flags[k] = rest.join('=');
      } else {
        const flagType = flagTypes.get(body);
        const next = tokens[i + 1];
        
        if (flagType === 'boolean') {
          flags[body] = true;
        } else if (next !== undefined && !next.startsWith('-')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else if (t.startsWith('-') && t.length === 2) {
      const key = t.slice(1);
      const flagType = flagTypes.get(key);
      const next = tokens[i + 1];
      
      if (flagType === 'boolean') {
        flags[key] = true;
      } else if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}

// ─── Help & tab-completion ────────────────────────────────────────────────────

export function optionSummary(
  options?: Record<
    string,
    { flag?: string; alias?: string; type: string; demandOption?: boolean }
  >
): string {
  if (!options) return '';
  return Object.entries(options)
    .map(([key, spec]) => {
      const flag = spec.flag ?? key;
      const token = `--${flag}${spec.alias ? `|-${spec.alias}` : ''} <${spec.type}>`;
      return spec.demandOption ? token : `[${token}]`;
    })
    .join(' ');
}

export function buildLeafHelp(node: LeafCommand): string {
  const lines: string[] = [];

  lines.push(`\n  ${chalk.bold(node.usage)}`);
  lines.push(`  ${chalk.gray(node.describe)}\n`);

  if (node.positionals?.length) {
    lines.push(chalk.cyan('  Positionals:'));
    const col = Math.max(...node.positionals.map((p) => p.name.length)) + 2;
    for (const p of node.positionals) {
      const req = p.demandOption ? chalk.red(' [required]') : '';
      lines.push(`    ${p.name.padEnd(col)}${p.describe ?? ''}${req}`);
    }
    lines.push('');
  }

  if (node.options && Object.keys(node.options).length) {
    lines.push(chalk.cyan('  Options:'));
    const entries = Object.entries(node.options);
    const col = Math.max(...entries.map(([k, s]) => (s.flag ?? k).length)) + 4;
    for (const [key, spec] of entries) {
      const flag = spec.flag ?? key;
      const alias = spec.alias ? `-${spec.alias}, ` : '    ';
      const label = `${alias}--${flag}`;
      const meta: string[] = [`[${spec.type}]`];
      if (spec.choices) meta.push(`[choices: ${spec.choices.join(', ')}]`);
      if (spec.default !== undefined) meta.push(`[default: ${spec.default}]`);
      if (spec.demandOption) meta.push(chalk.red('[required]'));
      const desc = spec.describe ? `  ${spec.describe}` : '';
      lines.push(`    ${label.padEnd(col)}${meta.join(' ')}${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildHelp(): string {
  const groups = new Map<string, string[]>();
  const addLine = (group: string, line: string) => {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(line);
  };

  for (const [key, node] of Object.entries(COMMANDS)) {
    if (node.cliOnly) continue;
    if (isGroup(node)) {
      for (const [, subNode] of Object.entries(node.subcommands)) {
        if (isGroup(subNode)) continue;
        const opts = optionSummary(subNode.options);
        addLine(
          node.group,
          `    ${key} ${subNode.usage}${opts ? ' ' + opts : ''}`
        );
      }
    } else {
      const opts = optionSummary(node.options);
      addLine(node.group, `    ${node.usage}${opts ? ' ' + opts : ''}`);
    }
  }

  const sections = Array.from(groups.entries()).map(
    ([group, lines]) => `  ${chalk.cyan(group)}\n${lines.join('\n')}`
  );

  return `\n${chalk.bold('Deployment Manager — available commands')}\n\n${sections.join('\n\n')}\n\n  ${chalk.cyan(
    'Shell'
  )}\n    help              Show this help\n    clear             Clear the screen\n    exit | quit       Exit the shell\n`;
}

export const TOP_LEVEL_COMMANDS = [
  ...Object.entries(COMMANDS)
    .filter(([, node]) => !node.cliOnly)
    .map(([key]) => key),
  'help',
  'clear',
  'exit',
  'quit',
];

// ─── Command dispatcher ───────────────────────────────────────────────────────

async function runNode(
  node: CommandNode,
  fullUsage: string,
  rest: string[]
): Promise<void> {
  if (isGroup(node)) {
    const [subKey, ...subRest] = rest;
    const subNode = subKey ? node.subcommands[subKey] : undefined;
    if (!subNode) {
      Logger.error(
        `Usage: ${fullUsage} <${Object.keys(node.subcommands).join('|')}>`
      );
      return;
    }
    const subUsage = isGroup(subNode)
      ? `${fullUsage} ${subKey}`
      : `${fullUsage} ${subNode.usage}`;
    await runNode(subNode, subUsage, subRest);
    return;
  }

  const { positional, flags } = parseTokens(rest, node.options);
  let args: Record<string, any>;
  try {
    args = resolveLeafArgs(node, positional, flags);
  } catch (err: any) {
    Logger.error(err?.message ?? String(err));
    Logger.print(buildLeafHelp(node));
    return;
  }

  if (node.lockArg) acquireLock(args[node.lockArg]);
  try {
    await node.handler(args);
  } finally {
    if (node.lockArg) releaseLock(args[node.lockArg]);
  }
}

export async function dispatch(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const [cmdKey, ...rest] = tokens;

  switch (cmdKey) {
    case 'help':
      Logger.print(buildHelp());
      return;
    case 'clear':
      // Handle clear command through special callback
      // The ReplPage component will hook this
      if ((dispatch as any)._clearCallback) {
        (dispatch as any)._clearCallback();
      }
      return;
    case 'exit':
    case 'quit':
      // Handle exit through special callback
      // The ReplPage component will hook this
      if ((dispatch as any)._exitCallback) {
        (dispatch as any)._exitCallback();
      }
      return;
  }

  const REMOTE_USER = process.env.DM_REMOTE_USER;
  
  // Block sensitive commands from remote sessions entirely.
  if (REMOTE_USER && REMOTE_BLOCKED_COMMANDS.has(cmdKey)) {
    Logger.error(
      `Command "${chalk.bold(cmdKey)}" is not allowed in a remote session. Run it locally on the server.`
    );
    return;
  }

  const node = COMMANDS[cmdKey];
  if (!node) {
    Logger.error(
      `Unknown command: ${chalk.bold(cmdKey)}. Type ${chalk.cyan('help')} for available commands.`
    );
    return;
  }

  if (node.cliOnly) {
    Logger.error(
      `Command "${chalk.bold(cmdKey)}" is only available via the CLI (\`dm ${cmdKey}\`), not the interactive shell.`
    );
    return;
  }

  await runNode(node, isGroup(node) ? cmdKey : node.usage, rest);
}

// ─── Remote session restrictions ─────────────────────────────────────────────
const REMOTE_BLOCKED_COMMANDS = new Set([
  'remote',
  'update',
  'install-service',
  'migrate-db',
]);

// ─── Remote command audit ─────────────────────────────────────────────────────
const REMOTE_USER = process.env.DM_REMOTE_USER;
const REMOTE_SESSION_TYPE = process.env.DM_REMOTE_SESSION_TYPE || 'shell';

export function auditCommand(line: string): void {
  if (!REMOTE_USER) return;
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event: 'repl-command',
      identity: REMOTE_USER,
      sessionType: REMOTE_SESSION_TYPE,
      command: line,
    });
    fs.appendFileSync(REMOTE_AUDIT_LOG_PATH, entry + '\n');
  } catch {
    /* non-fatal */
  }
}
