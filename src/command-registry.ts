// ─── Command registry ──────────────────────────────────────────────────────
//
// This is the single source of truth for every `dm` command: its arguments,
// options, validation, and business logic. Both cli.ts (yargs, for
// `dm <command>`) and repl.ts (for the interactive shell) build themselves
// from this file instead of each re-declaring the command surface.
//
// Adding/changing a command only ever means editing COMMANDS below — cli.ts
// and repl.ts pick the change up automatically (yargs parsing, REPL parsing,
// help text, and tab-completion all derive from this).
// ────────────────────────────────────────────────────────────────────────────

import { deploy } from './commands/deploy.js';
import { init } from './commands/init.js';
import {
  APP_DIR,
  NEXT_DIR,
  NEST_DIR,
  DOTNET_DIR,
  STATIC_DIR,
  SECRET_KEY,
  REMOTE_PORT,
} from './constants.js';
import { listApps } from './commands/list.js';
import { unlock } from './commands/unlock.js';
import { clean } from './commands/clean.js';
import { launchEnvEditorForApp } from './commands/set-env.js';
import { Delete } from './commands/delete.js';
import { startAllApplications } from './commands/start-all.js';
import { stopAllApplications } from './commands/stop-all.js';
import { update } from './commands/update.js';
import { info } from './commands/info.js';
import { restart } from './commands/restart.js';
import { stop } from './commands/stop.js';
import { rollback } from './commands/rollback.js';
import { dashboard } from './commands/dashboard.js';
import { cleanAll } from './commands/clean-all.js';
import {
  storageNew,
  storageAttach,
  storageDetach,
  storageRm,
  storageLs,
} from './commands/storage.js';
import {
  domainAdd,
  domainRemove,
  domainList,
  domainShow,
} from './commands/domain.js';
import { domainSetCert } from './commands/domain-set-cert.js';
import { domainCertStatus } from './commands/domain-cert-status.js';
import { domainRemoveCert } from './commands/domain-remove-cert.js';
import { domainReloadCerts } from './commands/domain-reload-certs.js';
import { routeAdd, routeRemove, routeList } from './commands/route.js';
import { domainRemoveHeader } from './commands/domain-remove-header.js';
import { domainCompile } from './commands/domain-compile.js';
import { domainShowConfig } from './commands/domain-show-config.js';
import { domainPush } from './commands/domain-push.js';
import { routeRemoveHeader } from './commands/route-remove-header.js';
import { migrateFromJSON } from './commands/migrate-db.js';
import { changeRepo } from './commands/change-repo.js';
import { installService } from './commands/install-service.js';
import {
  remoteServe,
  remoteKeyAdd,
  remoteKeyRemove,
  remoteKeyList,
  remoteStatus,
} from './commands/remote.js';
import { logClear } from './commands/log-clear.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PrimType = 'string' | 'number' | 'boolean';

export interface PositionalSpec {
  /** Exact token used in `usage`, e.g. 'name' for '<name>' or 'link-name' for '[link-name]'. */
  name: string;
  type?: PrimType;
  describe?: string;
  demandOption?: boolean;
}

export interface OptionSpec {
  /** The `--flag-name`. Defaults to the record key if omitted. */
  flag?: string;
  alias?: string;
  type: PrimType;
  default?: string | number | boolean;
  choices?: readonly string[];
  describe?: string;
  demandOption?: boolean;
}

export interface LeafCommand {
  kind: 'leaf';
  /** Full usage fragment including this command's own positionals, e.g. 'init <name>'. */
  usage: string;
  describe: string;
  /** Section heading used to group commands in the REPL `help` output. */
  group: string;
  positionals?: PositionalSpec[];
  options?: Record<string, OptionSpec>;
  /** If set, acquireLock/releaseLock wraps the handler, keyed by this arg. */
  lockArg?: string;
  /** True for commands that intentionally keep the process alive (e.g. `logs`). */
  streaming?: boolean;
  /**
   * If true, this command is only available in the CLI (`dm <command>`) and
   * will not appear in the REPL help, tab-completion, or be executable from
   * the interactive shell. Use for risky/infrastructure commands.
   */
  cliOnly?: boolean;
  /**
   * Optional teardown hook called by the REPL after a streaming command exits
   * (either via Ctrl+C or the underlying process ending). Use this for any
   * cleanup that is specific to the REPL context (e.g. restoring terminal
   * state) — the CLI path never calls it.
   */
  onStreamEnd?: () => void | Promise<void>;
  /** Receives a plain object combining resolved positionals + options. */
  handler: (args: Record<string, any>) => Promise<void> | void;
}

export interface GroupCommand {
  kind: 'group';
  describe: string;
  group: string;
  subcommands: Record<string, CommandNode>;
  /**
   * If true, this entire command group is only available in the CLI and will
   * not appear in the REPL help, tab-completion, or be executable from the
   * interactive shell. Use for risky/infrastructure command groups.
   */
  cliOnly?: boolean;
}

export type CommandNode = LeafCommand | GroupCommand;

export const isGroup = (node: CommandNode): node is GroupCommand =>
  node.kind === 'group';

// ─── Generic arg resolution (used by the REPL parser; yargs parses itself) ──

function coerce(
  raw: string | boolean,
  type: PrimType
): string | number | boolean {
  if (type === 'boolean') return raw === true || raw === 'true';
  if (type === 'number') return Number(raw);
  return String(raw);
}

/**
 * Resolves positional tokens + parsed flags into the same shape a yargs
 * handler would receive, applying defaults/choices/required checks —
 * so REPL commands are validated exactly like their CLI counterparts.
 *
 * Handles:
 *  - `--no-<flag>` negation for boolean options (sets the option to false)
 *  - boolean options: treats the string tokens "true"/"false" correctly so
 *    `--force true` and `--force false` work as expected in the REPL
 *  - alias resolution for both the flag name and its alias
 */
export function resolveLeafArgs(
  node: LeafCommand,
  positionalTokens: string[],
  flagTokens: Record<string, string | boolean>
): Record<string, any> {
  const args: Record<string, any> = {};

  // Build a lookup: flagName → key, alias → key, 'no-flagName' → key (bool negation)
  const flagToKey = new Map<string, string>();
  const negatedKeys = new Set<string>(); // keys where --no-<flag> was provided
  for (const [key, spec] of Object.entries(node.options ?? {})) {
    const flagName = spec.flag ?? key;
    flagToKey.set(flagName, key);
    if (spec.alias) flagToKey.set(spec.alias, key);
    if (spec.type === 'boolean') flagToKey.set(`no-${flagName}`, key);
  }

  // Pre-scan flagTokens for --no-<flag> negations
  for (const rawFlag of Object.keys(flagTokens)) {
    const key = flagToKey.get(rawFlag);
    if (key !== undefined && rawFlag.startsWith('no-')) {
      negatedKeys.add(key);
    }
  }

  (node.positionals ?? []).forEach((p, i) => {
    const raw = positionalTokens[i];
    if (raw === undefined) {
      if (p.demandOption)
        throw new Error(`Missing required argument: <${p.name}>`);
      return;
    }
    args[p.name] = coerce(raw, p.type ?? 'string');
  });

  for (const [key, spec] of Object.entries(node.options ?? {})) {
    const flagName = spec.flag ?? key;

    // --no-<flag> takes precedence: sets boolean to false immediately
    if (negatedKeys.has(key)) {
      if (spec.type !== 'boolean')
        throw new Error(`--no-${flagName} is only valid for boolean flags`);
      args[key] = false;
      continue;
    }

    const raw =
      flagTokens[flagName] ?? (spec.alias ? flagTokens[spec.alias] : undefined);

    if (raw === undefined) {
      if (spec.demandOption)
        throw new Error(`Missing required option: --${flagName}`);
      args[key] = spec.default;
      continue;
    }

    // For boolean flags, accept the bare flag (raw === true from parseTokens)
    // as well as explicit string "true"/"false" from --flag=true style input.
    const value = coerce(raw, spec.type);
    if (spec.choices && !spec.choices.includes(value as string)) {
      throw new Error(
        `Invalid value for --${flagName}. Choices: ${spec.choices.join(', ')}`
      );
    }
    args[key] = value;
  }

  return args;
}

// ─── Command tree ───────────────────────────────────────────────────────────

export const COMMANDS: Record<string, CommandNode> = {
  // ── App lifecycle ─────────────────────────────────────────────────────────
  init: {
    kind: 'leaf',
    usage: 'init <name>',
    describe: 'Initialize a new application',
    group: 'App lifecycle',
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application to initialize',
      },
    ],
    options: {
      repo: {
        alias: 'r',
        type: 'string',
        demandOption: true,
        describe: 'The repository URL of the application',
      },
      branch: {
        alias: 'b',
        type: 'string',
        default: 'main',
        describe: 'The branch to use',
      },
      instances: {
        alias: 'i',
        type: 'number',
        default: 1,
        describe: 'The number of instances to initialize (default: 1)',
      },
      port: {
        alias: 'p',
        type: 'number',
        describe: 'The port number to use (default: find an available one)',
      },
      type: {
        alias: 't',
        type: 'string',
        choices: ['nextjs', 'nestjs', 'dotnet', 'static'],
        default: 'nextjs',
        describe: 'The type of application',
      },
      projectDir: {
        flag: 'project-dir',
        alias: 'd',
        type: 'string',
        describe:
          'Subdirectory within the repo that contains the project (for monorepos)',
      },
      vcs: {
        type: 'string',
        choices: ['git', 'svn', 'local'],
        default: 'git',
        describe:
          'Version control system to use (use "local" for a local folder path)',
      },
    },
    lockArg: 'name',
    handler: async ({
      name,
      repo,
      branch,
      instances,
      port,
      type,
      projectDir,
      vcs,
    }) => {
      const appsDir =
        type === 'nestjs'
          ? NEST_DIR
          : type === 'dotnet'
            ? DOTNET_DIR
            : type === 'static'
              ? STATIC_DIR
              : NEXT_DIR;
      await init({
        name,
        repo,
        branch,
        instances,
        port,
        type,
        appsDir,
        projectDir,
        vcsType: vcs ?? 'git',
      });
    },
  },

  deploy: {
    kind: 'leaf',
    usage: 'deploy <name>',
    describe: 'Deploy or update an application',
    group: 'App lifecycle',
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application to deploy or update',
      },
    ],
    options: {
      force: {
        alias: 'f',
        type: 'boolean',
        default: false,
        describe: 'Force the deployment even if no changes are detected',
      },
      lint: {
        alias: 'l',
        type: 'boolean',
        default: false,
        describe: 'Run linting during the deployment process',
      },
    },
    lockArg: 'name',
    handler: async ({ name, force, lint }) => {
      await deploy({ name, force, lint });
    },
  },

  restart: {
    kind: 'leaf',
    usage: 'restart <name>',
    describe: 'Restart an application using its active build',
    group: 'App lifecycle',
    positionals: [
      { name: 'name', demandOption: true, describe: 'Application name' },
    ],
    lockArg: 'name',
    handler: async ({ name }) => {
      await restart({ name });
    },
  },

  stop: {
    kind: 'leaf',
    usage: 'stop <name>',
    describe: 'Stop a running application',
    group: 'App lifecycle',
    positionals: [
      { name: 'name', demandOption: true, describe: 'Application name' },
    ],
    lockArg: 'name',
    handler: async ({ name }) => {
      await stop({ name });
    },
  },

  rollback: {
    kind: 'leaf',
    usage: 'rollback <name>',
    describe: 'Roll back an application to a previous build',
    group: 'App lifecycle',
    positionals: [
      { name: 'name', demandOption: true, describe: 'Application name' },
    ],
    options: {
      to: {
        type: 'number',
        describe: 'Build index to roll back to (default: previous)',
      },
    },
    lockArg: 'name',
    handler: async ({ name, to }) => {
      await rollback({ name, to });
    },
  },

  'start-all': {
    kind: 'leaf',
    usage: 'start-all',
    describe: 'Start all applications',
    group: 'App lifecycle',
    handler: async () => {
      await startAllApplications();
    },
  },

  'stop-all': {
    kind: 'leaf',
    usage: 'stop-all',
    describe: 'Stop all applications',
    group: 'App lifecycle',
    handler: async () => {
      await stopAllApplications();
    },
  },

  delete: {
    kind: 'leaf',
    usage: 'delete <name> <secret>',
    describe: 'Delete an application',
    group: 'App lifecycle',
    cliOnly: true,
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application',
      },
      { name: 'secret', demandOption: true, describe: 'The secret key' },
    ],
    lockArg: 'name',
    handler: async ({ name, secret }) => {
      if (secret !== SECRET_KEY) throw new Error('Invalid secret key');
      await Delete({ name });
    },
  },

  // ── Info & monitoring ─────────────────────────────────────────────────────
  list: {
    kind: 'leaf',
    usage: 'list',
    describe: 'List all applications',
    group: 'Info & monitoring',
    options: {
      type: {
        alias: 't',
        type: 'string',
        describe: 'Filter by project type (e.g. nextjs, nestjs, dotnet)',
      },
      storages: {
        alias: 's',
        type: 'boolean',
        describe: 'Show storages column',
      },
      routes: { alias: 'r', type: 'boolean', describe: 'Show routes column' },
    },
    handler: async ({ type, storages, routes }) => {
      await listApps(type, storages, routes);
    },
  },

  info: {
    kind: 'leaf',
    usage: 'info <name>',
    describe: 'Show detailed info about an application',
    group: 'Info & monitoring',
    positionals: [
      { name: 'name', demandOption: true, describe: 'Application name' },
    ],
    handler: async ({ name }) => {
      await info({ name });
    },
  },

  logs: {
    kind: 'leaf',
    usage: 'logs <name>',
    describe: 'Stream live logs for an application',
    group: 'Info & monitoring',
    positionals: [
      { name: 'name', demandOption: true, describe: 'Application name' },
    ],
    streaming: true,
    // cli.ts and repl.ts each wrap this call with the keep-alive/SIGINT
    // handling their execution context needs (see the "streaming" note in
    // both files) — the actual work stays defined once, here.
    handler: async ({ name }) => {
      const { logs } = await import('./commands/logs.js');
      logs({ name });
    },
  },

  'log-clear': {
    kind: 'leaf',
    usage: 'log-clear [name]',
    describe: 'Clear log files for an application (or all apps with --all)',
    group: 'Info & monitoring',
    positionals: [
      { name: 'name', describe: 'Application name (omit when using --all)' },
    ],
    options: {
      all: {
        type: 'boolean',
        default: false,
        describe: 'Clear logs for all applications',
      },
    },
    handler: async ({ name, all }) => {
      await logClear({ name, all });
    },
  },

  monit: {
    kind: 'leaf',
    usage: 'monit',
    describe: 'Open the operational dashboard (alias: dashboard)',
    group: 'Info & monitoring',
    handler: async () => {
      await dashboard();
    },
  },

  dashboard: {
    kind: 'leaf',
    usage: 'dashboard',
    describe: 'Open the operational TUI dashboard',
    group: 'Info & monitoring',
    handler: async () => {
      await dashboard();
    },
  },

  // ── Environment ────────────────────────────────────────────────────────────
  'set-env': {
    kind: 'leaf',
    usage: 'set-env <name>',
    describe: 'Launch the interactive env editor for an application',
    group: 'Environment',
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application',
      },
    ],
    // Intentionally NOT locked: this hands off to a long-lived interactive
    // TUI editor session; holding the lock would block deploys/restarts.
    handler: async ({ name }) => {
      await launchEnvEditorForApp(name);
    },
  },

  unlock: {
    kind: 'leaf',
    usage: 'unlock <name>',
    describe:
      'Forcefully release the lock for an application by killing its process.',
    group: 'Environment',
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application',
      },
    ],
    handler: ({ name }) => {
      unlock({ name });
    },
  },

  clean: {
    kind: 'leaf',
    usage: 'clean <name>',
    describe: 'Clean app directory from local changes.',
    group: 'Environment',
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application',
      },
    ],
    lockArg: 'name',
    handler: async ({ name }) => {
      await clean({ name });
    },
  },

  'clean-all': {
    kind: 'leaf',
    usage: 'clean-all',
    describe:
      'Clean all apps: discard uncommitted changes and prune old builds',
    group: 'Environment',
    handler: async () => {
      await cleanAll();
    },
  },

  update: {
    kind: 'leaf',
    usage: 'update',
    describe: 'Update the dm tool',
    group: 'Environment',
    cliOnly: true,
    handler: async () => {
      await update();
    },
  },

  // ── Storage ────────────────────────────────────────────────────────────────
  storage: {
    kind: 'group',
    describe: 'Manage persistent storage volumes',
    group: 'Storage',
    subcommands: {
      new: {
        kind: 'leaf',
        usage: 'new <name> [link-name]',
        describe: 'Create a new storage',
        group: 'Storage',
        positionals: [
          {
            name: 'name',
            demandOption: true,
            describe: 'The storage directory name (e.g. metalunic-storage)',
          },
          {
            name: 'link-name',
            describe:
              'The symlink name created inside each build directory (defaults to name if not provided)',
          },
        ],
        handler: async ({ name, 'link-name': linkName }) => {
          await storageNew(name, linkName);
        },
      },
      attach: {
        kind: 'leaf',
        usage: 'attach <app> <storage>',
        describe: 'Attach a storage to an app',
        group: 'Storage',
        positionals: [
          {
            name: 'app',
            demandOption: true,
            describe: 'The name of the application',
          },
          {
            name: 'storage',
            demandOption: true,
            describe: 'The name of the storage to attach',
          },
        ],
        handler: async ({ app, storage }) => {
          await storageAttach(app, storage);
        },
      },
      detach: {
        kind: 'leaf',
        usage: 'detach <app> <storage>',
        describe: 'Detach a storage from an app',
        group: 'Storage',
        positionals: [
          {
            name: 'app',
            demandOption: true,
            describe: 'The name of the application',
          },
          {
            name: 'storage',
            demandOption: true,
            describe: 'The name of the storage to detach',
          },
        ],
        handler: async ({ app, storage }) => {
          await storageDetach(app, storage);
        },
      },
      rm: {
        kind: 'leaf',
        usage: 'rm <name>',
        describe: 'Delete a storage',
        group: 'Storage',
        positionals: [
          {
            name: 'name',
            demandOption: true,
            describe: 'The name of the storage to delete',
          },
        ],
        handler: async ({ name }) => {
          await storageRm(name);
        },
      },
      ls: {
        kind: 'leaf',
        usage: 'ls',
        describe: 'List all storages',
        group: 'Storage',
        handler: async () => {
          await storageLs();
        },
      },
    },
  },

  // ── Domain ─────────────────────────────────────────────────────────────────
  domain: {
    kind: 'group',
    describe: 'Manage reverse proxy domains',
    group: 'Domain',
    subcommands: {
      add: {
        kind: 'leaf',
        usage: 'add <name>',
        describe: 'Add a new domain',
        group: 'Domain',
        positionals: [
          {
            name: 'name',
            demandOption: true,
            describe: 'The domain name to add',
          },
        ],
        handler: async ({ name }) => {
          await domainAdd(name);
        },
      },
      remove: {
        kind: 'leaf',
        usage: 'remove <name>',
        describe: 'Remove a domain',
        group: 'Domain',
        positionals: [
          {
            name: 'name',
            demandOption: true,
            describe: 'The domain name to remove',
          },
        ],
        options: {
          force: {
            type: 'boolean',
            default: false,
            describe: 'Cascade delete all routes for this domain',
          },
        },
        handler: async ({ name, force }) => {
          await domainRemove(name, force);
        },
      },
      list: {
        kind: 'leaf',
        usage: 'list',
        describe: 'List all domains',
        group: 'Domain',
        handler: async () => {
          await domainList();
        },
      },
      show: {
        kind: 'leaf',
        usage: 'show <name>',
        describe: 'Show details for a domain',
        group: 'Domain',
        positionals: [
          {
            name: 'name',
            demandOption: true,
            describe: 'The domain name to show',
          },
        ],
        handler: async ({ name }) => {
          await domainShow(name);
        },
      },
      'set-cert': {
        kind: 'leaf',
        usage: 'set-cert <name>',
        describe: 'Attach an SSL certificate to a domain',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        options: {
          cert: {
            type: 'string',
            describe: 'Path to certificate file (any extension)',
          },
          key: {
            type: 'string',
            describe: 'Path to private key file (any extension)',
          },
          pfx: {
            type: 'string',
            describe: 'Path to PFX/PKCS#12 bundle (any extension)',
          },
          password: {
            type: 'string',
            describe: 'Password for PFX bundle (use "" for empty)',
          },
          force: {
            type: 'boolean',
            default: false,
            describe:
              'Attach certificate even if it does not cover the domain name',
          },
        },
        // This validation used to only run in cli.ts — the REPL's `domain
        // set-cert` skipped it entirely and passed flags straight through.
        // Now both paths get it because it lives on the handler.
        handler: async ({ name, cert, key, pfx, password, force }) => {
          const hasPem = Boolean(cert || key);
          const hasPfx = Boolean(pfx || password !== undefined);
          if (hasPem && hasPfx)
            throw new Error(
              'Use either --cert/--key or --pfx/--password, not both.'
            );
          if (!hasPem && !hasPfx)
            throw new Error(
              'Provide --cert and --key, or --pfx and --password.'
            );
          if (cert && !key) throw new Error('--cert requires --key.');
          if (key && !cert) throw new Error('--key requires --cert.');
          if (pfx && password === undefined)
            throw new Error('--pfx requires --password.');
          await domainSetCert(name, { cert, key, pfx, password, force });
        },
      },
      'cert-status': {
        kind: 'leaf',
        usage: 'cert-status <name>',
        describe: 'Show SSL certificate status for a domain',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        handler: async ({ name }) => {
          await domainCertStatus(name);
        },
      },
      'remove-cert': {
        kind: 'leaf',
        usage: 'remove-cert <name>',
        describe: 'Remove the SSL certificate from a domain',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        handler: async ({ name }) => {
          await domainRemoveCert(name);
        },
      },
      'reload-cert': {
        kind: 'leaf',
        usage: 'reload-cert [name]',
        describe:
          'Reload certificates from disk for all domains or a specific domain',
        group: 'Domain',
        positionals: [
          {
            name: 'name',
            describe: 'The domain name (omit to reload all domains)',
          },
        ],
        handler: async ({ name }) => {
          await domainReloadCerts(name);
        },
      },
      'set-header': {
        kind: 'leaf',
        usage: 'set-header <name>',
        describe: 'Launch the interactive header editor for a domain',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        handler: async ({ name }) => {
          const { launchDomainHeaderEditor } = await import(
            './tui/launch-header-editor.js'
          );
          await launchDomainHeaderEditor(name);
        },
      },
      'remove-header': {
        kind: 'leaf',
        usage: 'remove-header <name>',
        describe: 'Remove an HTTP response header from a domain',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        options: {
          key: {
            type: 'string',
            demandOption: true,
            describe: 'Header name to remove',
          },
        },
        handler: async ({ name, key }) => {
          await domainRemoveHeader(name, key);
        },
      },
      compile: {
        kind: 'leaf',
        usage: 'compile <name>',
        describe: 'Compile and write the Nginx config for a domain',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        handler: async ({ name }) => {
          await domainCompile(name);
        },
      },
      'show-config': {
        kind: 'leaf',
        usage: 'show-config <name>',
        describe:
          'Preview the Nginx config for a domain without writing to disk',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        handler: async ({ name }) => {
          await domainShowConfig(name);
        },
      },
      push: {
        kind: 'leaf',
        usage: 'push <name>',
        describe:
          'Push compiled domain config to Nginx (local or remote). Env vars: NGINX_REMOTE_HOST, NGINX_REMOTE_KEY, PUSH_CERT_DIR',
        group: 'Domain',
        positionals: [
          { name: 'name', demandOption: true, describe: 'The domain name' },
        ],
        handler: async ({ name }) => {
          await domainPush(name);
        },
      },
    },
  },

  // ── Route ──────────────────────────────────────────────────────────────────
  route: {
    kind: 'group',
    describe: 'Manage reverse proxy routes',
    group: 'Route',
    subcommands: {
      add: {
        kind: 'leaf',
        usage: 'add <appName> <domainName>',
        describe: 'Add a route for an app on a domain',
        group: 'Route',
        positionals: [
          {
            name: 'appName',
            demandOption: true,
            describe: 'The name of the application',
          },
          {
            name: 'domainName',
            demandOption: true,
            describe: 'The domain name',
          },
        ],
        options: {
          location: {
            alias: 'l',
            type: 'string',
            default: '',
            describe:
              'Route path without leading slash (e.g. "api", "admin/dashboard"). Root = omit or leave empty.',
          },
          force: {
            alias: 'f',
            type: 'boolean',
            default: false,
            describe:
              'Allow routing the app even if it is already routed elsewhere',
          },
        },
        handler: async ({ appName, domainName, location, force }) => {
          await routeAdd(appName, domainName, location, force);
        },
      },
      remove: {
        kind: 'leaf',
        usage: 'remove <domainName>',
        describe: 'Remove a route from a domain',
        group: 'Route',
        positionals: [
          {
            name: 'domainName',
            demandOption: true,
            describe: 'The domain name',
          },
        ],
        options: {
          location: {
            alias: 'l',
            type: 'string',
            default: '',
            describe:
              'Route path without leading slash (e.g. "api"). Root = omit or leave empty.',
          },
        },
        handler: async ({ domainName, location }) => {
          await routeRemove(domainName, location);
        },
      },
      list: {
        kind: 'leaf',
        usage: 'list <domainName>',
        describe: 'List all routes for a domain',
        group: 'Route',
        positionals: [
          {
            name: 'domainName',
            demandOption: true,
            describe: 'The domain name',
          },
        ],
        handler: async ({ domainName }) => {
          await routeList(domainName);
        },
      },
      'set-header': {
        kind: 'leaf',
        usage: 'set-header <domainName>',
        describe: 'Launch the interactive header editor for a route',
        group: 'Route',
        positionals: [
          {
            name: 'domainName',
            demandOption: true,
            describe: 'The domain name',
          },
        ],
        options: {
          location: {
            alias: 'l',
            type: 'string',
            default: '',
            describe:
              'Route path without leading slash (e.g. "api"). Root = omit or leave empty.',
          },
        },
        handler: async ({ domainName, location }) => {
          const { launchRouteHeaderEditor } = await import(
            './tui/launch-header-editor.js'
          );
          await launchRouteHeaderEditor(domainName, location ?? '');
        },
      },
      'remove-header': {
        kind: 'leaf',
        usage: 'remove-header <domainName>',
        describe: 'Remove an HTTP response header from a route',
        group: 'Route',
        positionals: [
          {
            name: 'domainName',
            demandOption: true,
            describe: 'The domain name',
          },
        ],
        options: {
          location: {
            alias: 'l',
            type: 'string',
            default: '',
            describe:
              'Route path without leading slash (e.g. "api"). Root = omit or leave empty.',
          },
          key: {
            type: 'string',
            demandOption: true,
            describe: 'Header name to remove',
          },
        },
        handler: async ({ domainName, location, key }) => {
          await routeRemoveHeader(domainName, location, key);
        },
      },
    },
  },

  // ── Database / misc ───────────────────────────────────────────────────────
  'migrate-db': {
    kind: 'leaf',
    usage: 'migrate-db',
    describe: 'Migrate data from legacy db.json to SQL database',
    group: 'Database',
    cliOnly: true,
    handler: async () => {
      await migrateFromJSON();
    },
  },

  'change-repo': {
    kind: 'leaf',
    usage: 'change-repo <name>',
    describe: 'Change the repository URL and/or branch for an application',
    group: 'Database',
    cliOnly: true,
    positionals: [
      {
        name: 'name',
        demandOption: true,
        describe: 'The name of the application',
      },
    ],
    options: {
      repo: {
        alias: 'r',
        type: 'string',
        describe: 'The new repository URL',
      },
      branch: {
        alias: 'b',
        type: 'string',
        describe: 'The new branch name',
      },
    },
    lockArg: 'name',
    handler: async ({ name, repo, branch }) => {
      await changeRepo({ name, newRepo: repo, newBranch: branch });
    },
  },

  'install-service': {
    kind: 'leaf',
    usage: 'install-service',
    describe: 'Install auto-startup service to run "dm start-all" on boot',
    group: 'Database',
    cliOnly: true,
    options: {
      uninstall: {
        type: 'boolean',
        default: false,
        describe: 'Uninstall the auto-startup service',
      },
    },
    handler: async ({ uninstall }) => {
      await installService({ uninstall });
    },
  },

  // ── Remote access ──────────────────────────────────────────────────────────
  remote: {
    kind: 'group',
    describe: 'Remote access to the dm shell on another machine over SSH',
    group: 'Remote',
    cliOnly: true,
    subcommands: {
      serve: {
        kind: 'leaf',
        usage: 'serve',
        describe: 'Start the dm SSH server in the foreground',
        group: 'Remote',
        streaming: true,
        options: {
          port: {
            alias: 'p',
            type: 'number',
            default: REMOTE_PORT,
            describe:
              'Port to listen on (default: REMOTE_PORT env var or 2022)',
          },
        },
        handler: async ({ port }) => {
          await remoteServe(port);
        },
      },

      add: {
        kind: 'leaf',
        usage: 'add',
        describe:
          'Authorize a public key for remote access (interactive: prompts for username then key). Clients can get their public key with: ssh-keygen -y -f ~/.ssh/id_ed25519',
        group: 'Remote',
        handler: async () => {
          await remoteKeyAdd();
        },
      },
      remove: {
        kind: 'leaf',
        usage: 'remove <username>',
        describe: 'Revoke an authorized public key by username',
        group: 'Remote',
        positionals: [
          {
            name: 'username',
            demandOption: true,
            describe:
              'The username whose key should be revoked (see "dm remote list")',
          },
        ],
        handler: async ({ username }) => {
          await remoteKeyRemove(username);
        },
      },
      list: {
        kind: 'leaf',
        usage: 'list',
        describe: 'List all authorized public keys',
        group: 'Remote',
        handler: async () => {
          await remoteKeyList();
        },
      },
      status: {
        kind: 'leaf',
        usage: 'status',
        describe: 'Show remote access configuration (keys, port)',
        group: 'Remote',
        handler: async () => {
          await remoteStatus();
        },
      },
    },
  },
};

// Ensure boot-time app directories exist. Both cli.ts and repl.ts call this
// once at startup instead of each repeating the same four existsSync/mkdirSync
// calls.
export async function ensureAppDirectories(): Promise<void> {
  const { existsSync, mkdirSync } = await import('fs');
  for (const dir of [APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR, STATIC_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
