import readline from 'readline';
import chalk from 'chalk';
import { COMMAND_GROUPS, TOP_LEVEL_COMMANDS } from './repl-commands.js';
import { setReplInterface } from './utils/repl-context.js';
import { deploy } from './commands/deploy.js';
import { init } from './commands/init.js';
import { APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR, STATIC_DIR, SECRET_KEY } from './constants.js';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import { Logger } from './utils/logger.js';
import { listApps } from './commands/list.js';
import { unlock } from './commands/unlock.js';
import { clean } from './commands/clean.js';
import { setEnvForApp, launchEnvEditorForApp } from './commands/set-env.js';
import { Delete } from './commands/delete.js';
import { startAllApplications } from './commands/start-all.js';
import { stopAllApplications } from './commands/stop-all.js';
import { update } from './commands/update.js';
import { info } from './commands/info.js';
import { restart } from './commands/restart.js';
import { stop } from './commands/stop.js';
import { rollback } from './commands/rollback.js';
import { logs } from './commands/logs.js';
import { dashboard } from './commands/dashboard.js';
import { cleanAll } from './commands/clean-all.js';
import { storageNew, storageAttach, storageDetach, storageRm, storageLs } from './commands/storage.js';
import { domainAdd, domainRemove, domainList, domainShow } from './commands/domain.js';
import { domainSetCert } from './commands/domain-set-cert.js';
import { domainCertStatus } from './commands/domain-cert-status.js';
import { domainRemoveCert } from './commands/domain-remove-cert.js';
import { domainReloadCerts } from './commands/domain-reload-certs.js';
import { routeAdd, routeRemove, routeList } from './commands/route.js';
import { domainSetHeader } from './commands/domain-set-header.js';
import { domainRemoveHeader } from './commands/domain-remove-header.js';
import { domainCompile } from './commands/domain-compile.js';
import { domainShowConfig } from './commands/domain-show-config.js';
import { domainPush } from './commands/domain-push.js';
import { routeSetHeader } from './commands/route-set-header.js';
import { routeRemoveHeader } from './commands/route-remove-header.js';
import { migrateFromJSON } from './commands/migrate-db.js';
import { changeRepo } from './commands/change-repo.js';
import { installService } from './commands/install-service.js';

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
// Parses --flag, --flag=value, --flag value, -f, -f value from token array.
// Returns { positional: string[], flags: Record<string, string|boolean> }
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

// ─── Help text (generated from COMMAND_GROUPS) ────────────────────────────────
function buildHelp(): string {
  const lines: string[] = [`\n${chalk.bold('Deployment Manager — available commands')}\n`];
  for (const group of COMMAND_GROUPS) {
    lines.push(`  ${chalk.cyan(group.label)}`);
    for (const cmd of group.commands) {
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          lines.push(`    ${sub.usage}`);
        }
      } else {
        lines.push(`    ${cmd.usage}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

const HELP = buildHelp();

// ─── Command dispatcher ───────────────────────────────────────────────────────
async function dispatch(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  const cmd = tokens[0];
  const rest = tokens.slice(1);
  const { positional, flags } = parseTokens(rest);

  // helper to get flag value with alias fallback
  const flag = (long: string, short?: string): string | boolean | undefined =>
    flags[long] ?? (short ? flags[short] : undefined);

  switch (cmd) {
    // ── App lifecycle ──────────────────────────────────────────────────────────
    case 'init': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: init <name> --repo <url>'); return; }
      const repo = flag('repo', 'r') as string;
      if (!repo) { Logger.error('--repo is required'); return; }
      const type = (flag('type', 't') as string | undefined) ?? 'nextjs';
      const appsDir = type === 'nestjs' ? NEST_DIR : type === 'dotnet' ? DOTNET_DIR : type === 'static' ? STATIC_DIR : NEXT_DIR;
      acquireLock(name);
      try {
        await init({
          name,
          repo,
          branch: (flag('branch', 'b') as string | undefined) ?? 'main',
          instances: Number(flag('instances', 'i') ?? 1),
          port: flag('port', 'p') ? Number(flag('port', 'p')) : undefined,
          type: type as any,
          appsDir,
          projectDir: flag('project-dir', 'd') as string | undefined,
          vcsType: ((flag('vcs') as string | undefined) ?? 'git') as any,
        });
      } finally { releaseLock(name); }
      break;
    }

    case 'deploy': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: deploy <name>'); return; }
      acquireLock(name);
      try {
        await deploy({
          name,
          force: Boolean(flag('force', 'f')),
          lint: Boolean(flag('lint', 'l')),
        });
      } finally { releaseLock(name); }
      break;
    }

    case 'restart': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: restart <name>'); return; }
      acquireLock(name);
      try { await restart({ name } as any); }
      finally { releaseLock(name); }
      break;
    }

    case 'stop': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: stop <name>'); return; }
      acquireLock(name);
      try { await stop({ name } as any); }
      finally { releaseLock(name); }
      break;
    }

    case 'rollback': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: rollback <name> [--to <index>]'); return; }
      acquireLock(name);
      try {
        await rollback({ name, to: flag('to') ? Number(flag('to')) : undefined });
      } finally { releaseLock(name); }
      break;
    }

    case 'start-all':
      await startAllApplications();
      break;

    case 'stop-all':
      await stopAllApplications();
      break;

    case 'delete': {
      const [name, secret] = positional;
      if (!name || !secret) { Logger.error('Usage: delete <name> <secret>'); return; }
      if (secret !== SECRET_KEY) { Logger.error('Invalid secret key'); return; }
      acquireLock(name);
      try { await Delete({ name } as any); }
      finally { releaseLock(name); }
      break;
    }

    // ── Info & monitoring ──────────────────────────────────────────────────────
    case 'list':
      await listApps(flag('type', 't') as string | undefined);
      break;

    case 'info': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: info <name>'); return; }
      await info({ name } as any);
      break;
    }

    case 'logs': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: logs <name>'); return; }
      // Stream until Ctrl+C — intercept the exit so we return to the prompt
      await new Promise<void>((resolve) => {
        // Save existing SIGINT listeners so we can restore them after
        const existingSigInt = process.rawListeners('SIGINT').slice() as ((...a: any[]) => void)[];
        process.removeAllListeners('SIGINT');

        const restore = () => {
          (process as any).exit = origExit;
          process.removeAllListeners('SIGINT');
          for (const l of existingSigInt) process.on('SIGINT', l);
          console.log('');
          resolve();
        };

        // logs() adds its own SIGINT that calls process.exit — we shadow process.exit
        const origExit = process.exit.bind(process) as (code?: number) => never;
        (process as any).exit = () => restore();

        // Also handle Ctrl+C before pm2 registers its own listener
        process.once('SIGINT', restore);

        logs({ name });
      });
      break;
    }

    case 'monit':
    case 'dashboard':
      await dashboard();
      break;

    // ── Environment ────────────────────────────────────────────────────────────
    case 'set-env': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: set-env <name> [KEY=VALUE]'); return; }
      const envArg = positional[1];
      if (!envArg) {
        await launchEnvEditorForApp(name);
      } else {
        const [envName, ...valParts] = envArg.split('=');
        const envValue = valParts.join('=');
        if (!envName || envValue === undefined) {
          Logger.error('Invalid format. Expected: KEY=VALUE');
          return;
        }
        await setEnvForApp({ name, envName, envValue });
      }
      break;
    }

    case 'unlock': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: unlock <name>'); return; }
      unlock({ name } as any);
      break;
    }

    case 'clean': {
      const name = positional[0];
      if (!name) { Logger.error('Usage: clean <name>'); return; }
      acquireLock(name);
      try { await clean({ name } as any); }
      finally { releaseLock(name); }
      break;
    }

    case 'clean-all':
      await cleanAll();
      break;

    case 'update':
      await update();
      break;

    // ── Storage ────────────────────────────────────────────────────────────────
    case 'storage': {
      const sub = positional[0];
      switch (sub) {
        case 'new': {
          const [, name, linkName] = positional;
          if (!name) { Logger.error('Usage: storage new <name> [link-name]'); return; }
          await storageNew(name, linkName);
          break;
        }
        case 'attach': {
          const [, app, storage] = positional;
          if (!app || !storage) { Logger.error('Usage: storage attach <app> <storage>'); return; }
          await storageAttach(app, storage);
          break;
        }
        case 'detach': {
          const [, app, storage] = positional;
          if (!app || !storage) { Logger.error('Usage: storage detach <app> <storage>'); return; }
          await storageDetach(app, storage);
          break;
        }
        case 'rm': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: storage rm <name>'); return; }
          await storageRm(name);
          break;
        }
        case 'ls':
          await storageLs();
          break;
        default:
          Logger.error(`Unknown storage subcommand: ${sub ?? '(none)'}. Try: new, attach, detach, rm, ls`);
      }
      break;
    }

    // ── Domain ─────────────────────────────────────────────────────────────────
    case 'domain': {
      const sub = positional[0];
      switch (sub) {
        case 'add': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain add <name>'); return; }
          await domainAdd(name);
          break;
        }
        case 'remove': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain remove <name> [--force]'); return; }
          await domainRemove(name, Boolean(flag('force', 'f')));
          break;
        }
        case 'list':
          await domainList();
          break;
        case 'show': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain show <name>'); return; }
          await domainShow(name);
          break;
        }
        case 'set-cert': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain set-cert <name> --cert <f> --key <f>'); return; }
          await domainSetCert(name, flags as any);
          break;
        }
        case 'cert-status': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain cert-status <name>'); return; }
          await domainCertStatus(name);
          break;
        }
        case 'remove-cert': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain remove-cert <name>'); return; }
          await domainRemoveCert(name);
          break;
        }
        case 'reload-certs': {
          const [, name] = positional;
          await domainReloadCerts(name);
          break;
        }
        case 'set-header': {
          const [, name] = positional;
          const k = flag('key') as string;
          const v = flag('value') as string;
          if (!name || !k || !v) { Logger.error('Usage: domain set-header <name> --key <k> --value <v>'); return; }
          await domainSetHeader(name, k, v);
          break;
        }
        case 'remove-header': {
          const [, name] = positional;
          const k = flag('key') as string;
          if (!name || !k) { Logger.error('Usage: domain remove-header <name> --key <k>'); return; }
          await domainRemoveHeader(name, k);
          break;
        }
        case 'compile': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain compile <name>'); return; }
          await domainCompile(name);
          break;
        }
        case 'show-config': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain show-config <name>'); return; }
          await domainShowConfig(name);
          break;
        }
        case 'push': {
          const [, name] = positional;
          if (!name) { Logger.error('Usage: domain push <name>'); return; }
          await domainPush(name);
          break;
        }
        default:
          Logger.error(`Unknown domain subcommand: ${sub ?? '(none)'}. Type "help" for usage.`);
      }
      break;
    }

    // ── Route ──────────────────────────────────────────────────────────────────
    case 'route': {
      const sub = positional[0];
      switch (sub) {
        case 'add': {
          const [, appName, domainName] = positional;
          if (!appName || !domainName) { Logger.error('Usage: route add <appName> <domainName> [--location path]'); return; }
          await routeAdd(appName, domainName, (flag('location', 'l') as string | undefined) ?? '', Boolean(flag('force', 'f')));
          break;
        }
        case 'remove': {
          const [, domainName] = positional;
          if (!domainName) { Logger.error('Usage: route remove <domainName> [--location path]'); return; }
          await routeRemove(domainName, (flag('location', 'l') as string | undefined) ?? '');
          break;
        }
        case 'list': {
          const [, domainName] = positional;
          if (!domainName) { Logger.error('Usage: route list <domainName>'); return; }
          await routeList(domainName);
          break;
        }
        case 'set-header': {
          const [, domainName] = positional;
          const k = flag('key') as string;
          const v = flag('value') as string;
          if (!domainName || !k || !v) { Logger.error('Usage: route set-header <domainName> --key <k> --value <v>'); return; }
          await routeSetHeader(domainName, (flag('location', 'l') as string | undefined) ?? '', k, v);
          break;
        }
        case 'remove-header': {
          const [, domainName] = positional;
          const k = flag('key') as string;
          if (!domainName || !k) { Logger.error('Usage: route remove-header <domainName> --key <k>'); return; }
          await routeRemoveHeader(domainName, (flag('location', 'l') as string | undefined) ?? '', k);
          break;
        }
        default:
          Logger.error(`Unknown route subcommand: ${sub ?? '(none)'}. Try: add, remove, list, set-header, remove-header`);
      }
      break;
    }

    // ── DB / misc ──────────────────────────────────────────────────────────────
    case 'migrate-db':
      await migrateFromJSON();
      break;

    case 'change-repo': {
      const name = positional[0];
      const newRepo = flag('repo', 'r') as string;
      if (!name || !newRepo) { Logger.error('Usage: change-repo <name> --repo <url>'); return; }
      acquireLock(name);
      try { await changeRepo({ name, newRepo }); }
      finally { releaseLock(name); }
      break;
    }

    case 'install-service':
      await installService({ uninstall: Boolean(flag('uninstall')) });
      break;

    // ── Shell meta ─────────────────────────────────────────────────────────────
    case 'help':
      console.log(HELP);
      break;

    case 'clear':
      process.stdout.write('\x1b[2J\x1b[H');
      break;

    case 'exit':
    case 'quit':
      console.log(chalk.gray('Goodbye.'));
      process.exit(0);
      break; // unreachable, satisfies no-fallthrough

    default:
      Logger.error(`Unknown command: ${chalk.bold(cmd)}. Type ${chalk.cyan('help')} for available commands.`);
  }
}

// ─── REPL entry point ─────────────────────────────────────────────────────────
export async function startRepl(version: string): Promise<void> {
  // Ensure directories exist (mirrors cli.ts boot-time logic)
  const { existsSync, mkdirSync } = await import('fs');
  for (const dir of [APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR, STATIC_DIR]) {
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

  const prompt = () => {
    // Re-emit prompt after streaming commands return
    rl.prompt();
  };

  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();
    if (!line) { prompt(); return; }

    const tokens = tokenise(line);
    try {
      await dispatch(tokens);
    } catch (err: any) {
      Logger.error(err?.message ?? err);
    }
    prompt();
  });

  // Keep process alive — readline keeps the event loop running naturally,
  // but we add an explicit no-op to be safe.
  await new Promise<void>((resolve) => rl.once('close', resolve));
}
