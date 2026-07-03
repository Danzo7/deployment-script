import yargs from 'yargs';
import { deploy } from './commands/deploy.js';
import { init } from './commands/init.js';
import { NEXT_DIR, NEST_DIR, DOTNET_DIR, SECRET_KEY } from './constants.js';
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

export interface YargsOptions {
  /**
   * When true (REPL mode):
   *  - handlers throw instead of calling process.exit(1)
   *  - streaming commands (logs) resolve when the user hits Ctrl+C
   *    rather than exiting the process
   *  - demandCommand / strictCommands are omitted so unknown input
   *    prints an error and returns to the prompt
   */
  replMode?: boolean;
}

interface InitArgs {
  name: string;
  repo: string;
  branch: string;
  instances: number;
  port?: number;
  type?: 'nextjs' | 'nestjs' | 'dotnet';
  projectDir?: string;
  vcs?: 'git' | 'svn';
}

interface DeployArgs {
  name: string;
  force: boolean;
  lint: boolean;
}

// In CLI mode errors call process.exit; in REPL mode they throw so the
// readline loop can catch them and print without killing the session.
function fail(err: unknown, repl: boolean): never {
  if (repl) throw err;
  Logger.error(err);
  process.exit(1);
}

// Wraps the logs() streaming command so it behaves differently per mode:
//  - CLI:  keeps process alive (yargs never resolves, pm2 SIGINT handler exits)
//  - REPL: resolves when Ctrl+C is pressed, restoring the original exit handler
function runLogs(name: string, repl: boolean): Promise<void> | void {
  if (!repl) {
    logs({ name });
    return new Promise(() => {}); // keep alive — pm2 owns lifecycle
  }

  return new Promise<void>((resolve) => {
    const existingSigInt = process.rawListeners('SIGINT').slice() as ((...a: unknown[]) => void)[];
    process.removeAllListeners('SIGINT');

    const restore = () => {
      (process as any).exit = origExit;
      process.removeAllListeners('SIGINT');
      for (const l of existingSigInt) process.on('SIGINT', l);
      console.log('');
      resolve();
    };

    const origExit = process.exit.bind(process) as (code?: number) => never;
    (process as any).exit = () => restore();
    process.once('SIGINT', restore);

    logs({ name });
  });
}

// Wraps lock acquire/release for commands that need it.
// In REPL mode we still acquire/release but never call process.exit on cleanup.
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  acquireLock(name);
  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}

export function buildYargs(argv: string[], opts: YargsOptions = {}) {
  const repl = opts.replMode ?? false;

  return yargs(argv)
    .scriptName('dm')
    .command<InitArgs>(
      'init <name>',
      'Initialize a new application',
      (y) =>
        y
          .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
          .option('repo', { type: 'string', demandOption: true, alias: 'r', describe: 'Repository URL' })
          .option('branch', { type: 'string', default: 'main', alias: 'b', describe: 'Branch name' })
          .option('instances', { type: 'number', default: 1, alias: 'i', describe: 'Number of instances' })
          .option('port', { type: 'number', alias: 'p', describe: 'Port number (default: auto)' })
          .option('type', { type: 'string', choices: ['nextjs', 'nestjs', 'dotnet'] as const, default: 'nextjs', alias: 't', describe: 'App type' })
          .option('project-dir', { type: 'string', alias: 'd', describe: 'Subdirectory for monorepos' })
          .option('vcs', { type: 'string', choices: ['git', 'svn'] as const, default: 'git', describe: 'Version control system' }),
      async (args) => {
        try {
          const appsDir = args.type === 'nestjs' ? NEST_DIR : args.type === 'dotnet' ? DOTNET_DIR : NEXT_DIR;
          await withLock(args.name, () => init({ ...args, appsDir, projectDir: args.projectDir, vcsType: args.vcs ?? 'git' }));
        } catch (err) { fail(err, repl); }
      }
    )
    .command<DeployArgs>(
      'deploy <name>',
      'Deploy or update an application',
      (y) =>
        y
          .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
          .option('force', { type: 'boolean', alias: 'f', default: false, describe: 'Force deploy even if no changes' })
          .option('lint', { type: 'boolean', alias: 'l', default: false, describe: 'Run linting during deploy' }),
      async (args) => {
        try {
          await withLock(args.name, () => deploy({ name: args.name, force: args.force, lint: args.lint }));
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'list',
      'List all applications',
      (y) => y.option('type', { alias: 't', type: 'string', describe: 'Filter by type (nextjs, nestjs, dotnet)' }),
      async (args) => {
        try {
          await listApps(args.type as string | undefined);
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'unlock <name>',
      'Forcefully release the lock for an application',
      (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
      (args) => {
        try {
          unlock(args);
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'clean <name>',
      'Clean app directory from local changes',
      (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
      async (args) => {
        try {
          await withLock(args.name as string, () => clean(args));
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'set-env <name> [env]',
      'Set an env var (KEY=VALUE), or launch interactive editor when no KEY=VALUE is given',
      (y) =>
        y
          .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
          .positional('env', { type: 'string', describe: 'VAR_NAME=VALUE (omit to open interactive editor)' }),
      async (args) => {
        try {
          const { name, env } = args as { name: string; env?: string };
          if (!env) {
            await launchEnvEditorForApp(name);
            return;
          }
          const eqIdx = env.indexOf('=');
          if (eqIdx < 1) { Logger.error('Invalid format. Expected: VAR_NAME=VALUE'); return; }
          await setEnvForApp({ name, envName: env.slice(0, eqIdx), envValue: env.slice(eqIdx + 1) });
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'delete <name> <secret>',
      'Delete an application',
      (y) =>
        y
          .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
          .positional('secret', { type: 'string', demandOption: true, describe: 'Secret key' }),
      async (args) => {
        try {
          if (args.secret !== SECRET_KEY) { Logger.error('Invalid secret key'); return; }
          await withLock(args.name as string, () => Delete(args));
        } catch (err) { fail(err, repl); }
      }
    )
    .command('start-all', 'Start all applications', (y) => y, async () => {
      try { await startAllApplications(); } catch (err) { fail(err, repl); }
    })
    .command('stop-all', 'Stop all applications', (y) => y, async () => {
      try { await stopAllApplications(); } catch (err) { fail(err, repl); }
    })
    .command('clean-all', 'Clean all apps: discard uncommitted changes and prune old builds', (y) => y, async () => {
      try { await cleanAll(); } catch (err) { fail(err, repl); }
    })
    .command('update', 'Update the dm tool', (y) => y, async () => {
      try { await update(); } catch (err) { fail(err, repl); }
    })
    .command(
      'info <name>',
      'Show detailed info about an application',
      (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
      async (args) => {
        try { await info(args as any); } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'restart <name>',
      'Restart an application using its active build',
      (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
      async (args) => {
        try {
          await withLock(args.name as string, () => restart(args as any));
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'stop <name>',
      'Stop a running application',
      (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
      async (args) => {
        try {
          await withLock(args.name as string, () => stop(args as any));
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'rollback <name>',
      'Roll back an application to a previous build',
      (y) =>
        y
          .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
          .option('to', { type: 'number', describe: 'Build index to roll back to (default: previous)' }),
      async (args) => {
        try {
          await withLock(args.name as string, () => rollback({ name: args.name as string, to: args.to }));
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'logs <name>',
      'Stream live logs for an application',
      (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
      async (args) => {
        try {
          return await runLogs(args.name as string, repl);
        } catch (err) { fail(err, repl); }
      }
    )
    .command('monit', 'Open the operational dashboard (alias: dashboard)', (y) => y, async () => {
      try { await dashboard(); } catch (err) { fail(err, repl); }
    })
    .command('dashboard', 'Open the operational TUI dashboard', (y) => y, async () => {
      try { await dashboard(); } catch (err) { fail(err, repl); }
    })
    .command(
      'storage',
      'Manage persistent storage volumes',
      (y) =>
        y
          .command(
            'new <name> [link-name]',
            'Create a new storage',
            (y) =>
              y
                .positional('name', { type: 'string', demandOption: true, describe: 'Storage directory name' })
                .positional('link-name', { type: 'string', describe: 'Symlink name inside build directories' }),
            async (args) => {
              try { await storageNew(args.name as string, args['link-name'] as string | undefined); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'attach <app> <storage>',
            'Attach a storage to an app',
            (y) =>
              y
                .positional('app', { type: 'string', demandOption: true, describe: 'Application name' })
                .positional('storage', { type: 'string', demandOption: true, describe: 'Storage name' }),
            async (args) => {
              try { await storageAttach(args.app as string, args.storage as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'detach <app> <storage>',
            'Detach a storage from an app',
            (y) =>
              y
                .positional('app', { type: 'string', demandOption: true, describe: 'Application name' })
                .positional('storage', { type: 'string', demandOption: true, describe: 'Storage name' }),
            async (args) => {
              try { await storageDetach(args.app as string, args.storage as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'rm <name>',
            'Delete a storage',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Storage name' }),
            async (args) => {
              try { await storageRm(args.name as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command('ls', 'List all storages', (y) => y, async () => {
            try { await storageLs(); } catch (err) { fail(err, repl); }
          })
          .demandCommand(1),
      () => {}
    )
    .command(
      'domain',
      'Manage reverse proxy domains',
      (y) =>
        y
          .command(
            'add <name>',
            'Add a new domain',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainAdd(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'remove <name>',
            'Remove a domain',
            (y) =>
              y
                .positional('name', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('force', { type: 'boolean', default: false, describe: 'Cascade delete all routes' }),
            async (args) => {
              try { await domainRemove(args.name as string, args.force as boolean); }
              catch (err) { fail(err, repl); }
            }
          )
          .command('list', 'List all domains', (y) => y, async () => {
            try { await domainList(); } catch (err) { fail(err, repl); }
          })
          .command(
            'show <name>',
            'Show details for a domain',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainShow(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'set-cert <name>',
            'Attach an SSL certificate to a domain',
            (y) =>
              y
                .positional('name', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('cert', { type: 'string', describe: 'Path to certificate file' })
                .option('key', { type: 'string', describe: 'Path to private key file' })
                .option('pfx', { type: 'string', describe: 'Path to PFX/PKCS#12 bundle' })
                .option('password', { type: 'string', describe: 'Password for PFX bundle' })
                .option('force', { type: 'boolean', default: false, describe: 'Skip domain name coverage check' }),
            async (args) => {
              try {
                const hasPem = args.cert || args.key;
                const hasPfx = args.pfx || args.password !== undefined;
                if (hasPem && hasPfx) throw new Error('Use either --cert/--key or --pfx/--password, not both.');
                if (!hasPem && !hasPfx) throw new Error('Provide --cert and --key, or --pfx and --password.');
                if (args.cert && !args.key) throw new Error('--cert requires --key.');
                if (args.key && !args.cert) throw new Error('--key requires --cert.');
                if (args.pfx && args.password === undefined) throw new Error('--pfx requires --password.');
                await domainSetCert(args.name as string, args as any);
              } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'cert-status <name>',
            'Show SSL certificate status for a domain',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainCertStatus(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'remove-cert <name>',
            'Remove the SSL certificate from a domain',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainRemoveCert(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'reload-certs [name]',
            'Reload certificates from disk for all domains or a specific domain',
            (y) => y.positional('name', { type: 'string', describe: 'Domain name (omit for all)' }),
            async (args) => {
              try { await domainReloadCerts(args.name as string | undefined); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'set-header <name>',
            'Set or update an HTTP response header on a domain',
            (y) =>
              y
                .positional('name', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('key', { type: 'string', demandOption: true, describe: 'Header name' })
                .option('value', { type: 'string', demandOption: true, describe: 'Header value' }),
            async (args) => {
              try { await domainSetHeader(args.name as string, args.key as string, args.value as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'remove-header <name>',
            'Remove an HTTP response header from a domain',
            (y) =>
              y
                .positional('name', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('key', { type: 'string', demandOption: true, describe: 'Header name to remove' }),
            async (args) => {
              try { await domainRemoveHeader(args.name as string, args.key as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'compile <name>',
            'Compile and write the Nginx config for a domain',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainCompile(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'show-config <name>',
            'Preview the Nginx config for a domain without writing to disk',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainShowConfig(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'push <name>',
            'Push compiled domain config to Nginx (local or remote)',
            (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await domainPush(args.name as string); } catch (err) { fail(err, repl); }
            }
          )
          .demandCommand(1),
      () => {}
    )
    .command(
      'route',
      'Manage reverse proxy routes',
      (y) =>
        y
          .command(
            'add <appName> <domainName>',
            'Add a route for an app on a domain',
            (y) =>
              y
                .positional('appName', { type: 'string', demandOption: true, describe: 'Application name' })
                .positional('domainName', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('location', { type: 'string', alias: 'l', default: '', describe: 'Route path (e.g. "api"). Root = omit.' })
                .option('force', { type: 'boolean', alias: 'f', default: false, describe: 'Allow re-routing an already-routed app' }),
            async (args) => {
              try { await routeAdd(args.appName as string, args.domainName as string, args.location as string, args.force as boolean); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'remove <domainName>',
            'Remove a route from a domain',
            (y) =>
              y
                .positional('domainName', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('location', { type: 'string', alias: 'l', default: '', describe: 'Route path. Root = omit.' }),
            async (args) => {
              try { await routeRemove(args.domainName as string, args.location as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'list <domainName>',
            'List all routes for a domain',
            (y) => y.positional('domainName', { type: 'string', demandOption: true, describe: 'Domain name' }),
            async (args) => {
              try { await routeList(args.domainName as string); } catch (err) { fail(err, repl); }
            }
          )
          .command(
            'set-header <domainName>',
            'Set or update an HTTP response header on a route',
            (y) =>
              y
                .positional('domainName', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('location', { type: 'string', alias: 'l', default: '', describe: 'Route path. Root = omit.' })
                .option('key', { type: 'string', demandOption: true, describe: 'Header name' })
                .option('value', { type: 'string', demandOption: true, describe: 'Header value' }),
            async (args) => {
              try { await routeSetHeader(args.domainName as string, args.location as string, args.key as string, args.value as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .command(
            'remove-header <domainName>',
            'Remove an HTTP response header from a route',
            (y) =>
              y
                .positional('domainName', { type: 'string', demandOption: true, describe: 'Domain name' })
                .option('location', { type: 'string', alias: 'l', default: '', describe: 'Route path. Root = omit.' })
                .option('key', { type: 'string', demandOption: true, describe: 'Header name to remove' }),
            async (args) => {
              try { await routeRemoveHeader(args.domainName as string, args.location as string, args.key as string); }
              catch (err) { fail(err, repl); }
            }
          )
          .demandCommand(1),
      () => {}
    )
    .command(
      'migrate-db',
      'Migrate data from legacy db.json to SQL database',
      (y) => y,
      async () => {
        try { await migrateFromJSON(); } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'change-repo <name>',
      'Change the repository URL for an application',
      (y) =>
        y
          .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
          .option('repo', { type: 'string', demandOption: true, alias: 'r', describe: 'New repository URL' }),
      async (args) => {
        try {
          await withLock(args.name as string, () => changeRepo({ name: args.name as string, newRepo: args.repo as string }));
        } catch (err) { fail(err, repl); }
      }
    )
    .command(
      'install-service',
      'Install auto-startup service to run "dm start-all" on boot',
      (y) => y.option('uninstall', { type: 'boolean', default: false, describe: 'Uninstall the service' }),
      async (args) => {
        try { await installService({ uninstall: args.uninstall }); } catch (err) { fail(err, repl); }
      }
    );
}
