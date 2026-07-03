import readline from 'readline';
import chalk from 'chalk';
import { existsSync, mkdirSync } from 'fs';
import { APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR } from './constants.js';
import { Logger } from './utils/logger.js';
import { buildYargs } from './yargs-config.js';
import { setReplInterface } from './utils/repl-context.js';

// Quote-aware tokeniser so things like  set-env api KEY="hello world"  work
function tokenise(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of line) {
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

const TOP_LEVEL_COMMANDS = [
  'init', 'deploy', 'list', 'unlock', 'clean', 'clean-all', 'set-env',
  'delete', 'start-all', 'stop-all', 'update', 'info', 'restart', 'stop',
  'rollback', 'logs', 'monit', 'dashboard', 'storage', 'domain', 'route',
  'migrate-db', 'change-repo', 'install-service', 'help', 'clear', 'exit', 'quit',
];

export async function startRepl(version: string): Promise<void> {
  for (const dir of [APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  console.log(chalk.bold(`\nDeployment Manager v${version}`));
  console.log(chalk.gray('Type "help" for available commands.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('dm> '),
    completer: (line: string) => {
      const hits = TOP_LEVEL_COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : TOP_LEVEL_COMMANDS, line];
    },
  });

  setReplInterface(rl);
  rl.on('close', () => { setReplInterface(null); process.exit(0); });
  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();

    if (!line) { rl.prompt(); return; }

    // Built-in shell meta-commands
    if (line === 'exit' || line === 'quit') {
      console.log(chalk.gray('Goodbye.'));
      process.exit(0);
    }
    if (line === 'clear') {
      process.stdout.write('\x1b[2J\x1b[H');
      rl.prompt();
      return;
    }
    if (line === 'help') {
      // Delegate to yargs --help so it's always in sync with the real definitions
      try {
        await buildYargs(['--help'], { replMode: true }).exitProcess(false).parseAsync();
      } catch { /* yargs may throw on --help with exitProcess(false) */ }
      rl.prompt();
      return;
    }

    const tokens = tokenise(line);
    try {
      await buildYargs(tokens, { replMode: true })
        .exitProcess(false)
        // In REPL mode unknown commands should print an error, not kill the session
        .fail((msg, err) => {
          Logger.error(msg || err);
        })
        .parseAsync();
    } catch (err: any) {
      Logger.error(err?.message ?? err);
    }

    rl.prompt();
  });

  await new Promise<void>((resolve) => rl.once('close', resolve));
}
