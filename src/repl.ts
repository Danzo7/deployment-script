import readline, { Interface } from 'readline';
import chalk from 'chalk';
import { Logger } from './utils/logger.js';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import {
  setReplInterface,
  getActiveRl,
  setReplFactory,
  isHandingOff,
} from './utils/repl-context.js';
import {
  COMMANDS,
  CommandNode,
  LeafCommand,
  isGroup,
  resolveLeafArgs,
  ensureAppDirectories,
} from './command-registry.js';

// ─── Tokeniser ────────────────────────────────────────────────────────────────
// Splits input respecting single/double quotes, e.g.:
//   set-env api KEY="hello world"  →  ['set-env', 'api', 'KEY=hello world']
function tokenise(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (cur.length) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}

// ─── Option parser ────────────────────────────────────────────────────────────
// Parses --flag, --flag=value, --flag value, -f, -f value from a token array.
function parseTokens(tokens: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const body = t.slice(2);
      if (body.includes('=')) {
        const [k, ...rest] = body.split('=');
        flags[k] = rest.join('=');
      } else {
        const next = tokens[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else if (t.startsWith('-') && t.length === 2) {
      const key = t.slice(1);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
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

// ─── Help & tab-completion (generated from command-registry.ts) ─────────────
// There is no second, hand-maintained list of commands here: both are
// derived from COMMANDS, so they can't drift out of sync with what actually
// runs the way the old hardcoded HELP string and TOP_LEVEL_COMMANDS array
// used to.

function optionSummary(options?: Record<string, { flag?: string; alias?: string; type: string; demandOption?: boolean }>): string {
  if (!options) return '';
  return Object.entries(options)
    .map(([key, spec]) => {
      const flag = spec.flag ?? key;
      const token = `--${flag}${spec.alias ? `|-${spec.alias}` : ''} <${spec.type}>`;
      return spec.demandOption ? token : `[${token}]`;
    })
    .join(' ');
}

function buildHelp(): string {
  const groups = new Map<string, string[]>();
  const addLine = (group: string, line: string) => {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(line);
  };

  for (const [key, node] of Object.entries(COMMANDS)) {
    if (isGroup(node)) {
      for (const [, subNode] of Object.entries(node.subcommands)) {
        if (isGroup(subNode)) continue; // no 2-level nesting today
        const opts = optionSummary(subNode.options);
        addLine(node.group, `    ${key} ${subNode.usage}${opts ? ' ' + opts : ''}`);
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

const TOP_LEVEL_COMMANDS = [...Object.keys(COMMANDS), 'help', 'clear', 'exit', 'quit'];

// ─── Streaming commands (e.g. `logs`) ────────────────────────────────────────
// `logs` tails until Ctrl+C. In the CLI that just means "keep the process
// alive" — but inside the REPL, Ctrl+C must return to the `dm>` prompt
// instead of killing the whole shell. That SIGINT juggling is REPL-specific
// plumbing, so it lives here rather than in command-registry.ts; the actual
// log-tailing logic is still defined exactly once, in the registry.
async function runStreamingInRepl(node: LeafCommand, args: Record<string, any>): Promise<void> {
  await new Promise<void>((resolveDone) => {
    const existingSigInt = process.rawListeners('SIGINT').slice() as ((...a: any[]) => void)[];
    process.removeAllListeners('SIGINT');

    const origExit = process.exit.bind(process) as (code?: number) => never;

    const restore = () => {
      (process as any).exit = origExit;
      process.removeAllListeners('SIGINT');
      for (const l of existingSigInt) process.on('SIGINT', l);
      console.log('');
      resolveDone();
    };

    // The underlying command may call process.exit() itself on SIGINT (pm2
    // does) — shadow it so that instead returns us to the prompt.
    (process as any).exit = () => restore();
    process.once('SIGINT', restore);

    void node.handler(args);
  });
}

// ─── Command dispatcher ───────────────────────────────────────────────────────
// Walks the same COMMANDS tree cli.ts registers with yargs, resolving
// positionals/flags with the exact same rules (see resolveLeafArgs in
// command-registry.ts) so a command behaves identically whether it's run as
// `dm <command>` or typed at the `dm>` prompt.
async function runNode(node: CommandNode, fullUsage: string, rest: string[]): Promise<void> {
  if (isGroup(node)) {
    const [subKey, ...subRest] = rest;
    const subNode = subKey ? node.subcommands[subKey] : undefined;
    if (!subNode) {
      Logger.error(`Usage: ${fullUsage} <${Object.keys(node.subcommands).join('|')}>`);
      return;
    }
    const subUsage = isGroup(subNode) ? `${fullUsage} ${subKey}` : `${fullUsage} ${subNode.usage}`;
    await runNode(subNode, subUsage, subRest);
    return;
  }

  const { positional, flags } = parseTokens(rest);
  let args: Record<string, any>;
  try {
    args = resolveLeafArgs(node, positional, flags);
  } catch (err: any) {
    Logger.error(err?.message ?? String(err));
    Logger.info(`Usage: ${fullUsage}`);
    return;
  }

  if (node.lockArg) acquireLock(args[node.lockArg]);
  try {
    if (node.streaming) {
      await runStreamingInRepl(node, args);
    } else {
      await node.handler(args);
    }
  } finally {
    if (node.lockArg) releaseLock(args[node.lockArg]);
  }
}

async function dispatch(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const [cmdKey, ...rest] = tokens;

  switch (cmdKey) {
    case 'help':
      console.log(buildHelp());
      return;
    case 'clear':
      process.stdout.write('\x1b[2J\x1b[H');
      return;
    case 'exit':
    case 'quit':
      console.log(chalk.gray('Goodbye.'));
      process.exit(0);
  }

  const node = COMMANDS[cmdKey];
  if (!node) {
    Logger.error(`Unknown command: ${chalk.bold(cmdKey)}. Type ${chalk.cyan('help')} for available commands.`);
    return;
  }

  await runNode(node, isGroup(node) ? cmdKey : node.usage, rest);
}

// ─── REPL entry point ─────────────────────────────────────────────────────────
export async function startRepl(version: string): Promise<void> {
  await ensureAppDirectories();

  console.log(chalk.bold(`\nDeployment Manager v${version}`));
  console.log(chalk.gray('Type "help" for available commands.\n'));

  let resolveExit: () => void;
  const exited = new Promise<void>((resolve) => { resolveExit = resolve; });

  // Builds a fully-configured readline interface. Registered with
  // repl-context.ts so that pauseRepl()/resumeRepl() can close this instance
  // for a TUI handoff and rebuild an identical one afterwards, instead of
  // trying to pause/resume a single instance that Ink would otherwise fight
  // over stdin with (see the comment in utils/repl-context.ts for why).
  const createInterface = (): Interface => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('dm> '),
      completer: (line: string) => {
        const hits = TOP_LEVEL_COMMANDS.filter((c) => c.startsWith(line));
        return [hits.length ? hits : TOP_LEVEL_COMMANDS, line];
      },
    });

    rl.on('close', () => {
      // A close means either the user hit Ctrl+D (real exit) or
      // pauseRepl() intentionally tore this interface down for a TUI
      // handoff — only actually end the shell for the former.
      if (isHandingOff()) return;
      setReplInterface(null);
      resolveExit();
    });

    rl.on('line', async (rawLine) => {
      const line = rawLine.trim();
      if (!line) { rl.prompt(); return; }

      const tokens = tokenise(line);
      try {
        await dispatch(tokens);
      } catch (err: any) {
        Logger.error(err?.message ?? err);
      }

      // A command may have paused *this* rl and had resumeRepl() build and
      // prompt a brand new one already (e.g. `dashboard`, `set-env` with no
      // KEY=VALUE) — only re-prompt here if this rl is still the active one.
      if (getActiveRl() === rl) rl.prompt();
    });

    return rl;
  };

  setReplFactory(createInterface);
  setReplInterface(createInterface());
  getActiveRl()!.prompt();

  await exited;
}
