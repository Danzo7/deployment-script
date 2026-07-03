#!/usr/bin/env node
import yargs from 'yargs';
import chalk from 'chalk';
import { deploy } from './commands/deploy.js';
import { init } from './commands/init.js';
import { APP_DIR, NEXT_DIR, NEST_DIR, DOTNET_DIR, SECRET_KEY } from './constants.js';
import { acquireLock, releaseLock } from './utils/lock-utils.js';
import { Logger } from './utils/logger.js';
import { listApps } from './commands/list.js';
import { existsSync, mkdirSync } from 'fs';
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
import { migrateFromJSON, isMigrationNeeded } from './commands/migrate-db.js';
import { changeRepo } from './commands/change-repo.js';
import { installService } from './commands/install-service.js';
import { startRepl } from './repl.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const _require = createRequire(import.meta.url);
const _pkg = _require(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')) as { version: string };

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

// Centralized cleanup logic
const setupCleanup = (name: string) => {
  const cleanUp = () => {
    releaseLock(name);
    process.exit();
  };
  process.on('exit', cleanUp);
  process.on('SIGINT', cleanUp);
  process.on('uncaughtException', (err) => {
    Logger.error('Unhandled exception:', err);
    cleanUp();
  });
};
if (!existsSync(APP_DIR)) {
  mkdirSync(APP_DIR, { recursive: true });
}
if (!existsSync(NEXT_DIR)) {
  mkdirSync(NEXT_DIR, { recursive: true });
}
if (!existsSync(NEST_DIR)) {
  mkdirSync(NEST_DIR, { recursive: true });
}
if (!existsSync(DOTNET_DIR)) {
  mkdirSync(DOTNET_DIR, { recursive: true });
}
const startTime = Date.now(); // Start the timer

// Check if migration is needed and prompt user
if (isMigrationNeeded()) {
  Logger.info(chalk.yellow('\n⚠️  Legacy db.json file detected!'));
  Logger.info(chalk.cyan('The database has been migrated to SQL (SQLite/PostgreSQL).'));
  Logger.info(chalk.cyan('Run "dm migrate-db" to migrate your data from db.json to the new database.\n'));
}

// ─── Interactive REPL mode ────────────────────────────────────────────────────
// When called with no arguments (just `dm`), launch the interactive shell.
if (process.argv.slice(2).length === 0) {
  await startRepl(_pkg.version);
  process.exit(0);
}

try {
  await yargs(process.argv.slice(2)).scriptName('dm')
    .middleware((argv) => {
      const { name ,_} = argv as any as DeployArgs&{_: string[]};
      if (name&&_[0]!="unlock") {
        acquireLock(name);
        setupCleanup(name);
      }
    })
    .command<InitArgs>(
      'init <name>',
      'Initialize a new application',
      (yargs) =>
        yargs
          .positional('name', {
            type: 'string',
            demandOption: true,
            describe: 'The name of the application to initialize',
          })
          .option('repo', {
            type: 'string',
            demandOption: true,
            alias: 'r',
            describe: 'The repository URL of the application',
          })
          .option('branch', {
            type: 'string',
            default: 'main',
            alias: 'b',
            describe:'The port number to use for the application. Defaults to an available port starting from 50xxx if not specified.',
          })
          .option('instances', {
            type: 'number',
            default: 1,
            alias: 'i',
            describe: 'The number of instances to initialize (default: 1)',
          })
          .option('port', {
            type: 'number',
            alias: 'p',
            describe: 'The port number to use for the application (default: find)',
          })
          .option('type', {
            type: 'string',
            choices: ['nextjs', 'nestjs', 'dotnet'],
            default: 'nextjs',
            alias: 't',
            describe: 'The type of application (nextjs, nestjs, or dotnet)',
          })
          .option('project-dir', {
            type: 'string',
            alias: 'd',
            describe: 'Subdirectory within the repo that contains the project (for monorepos)',
          })
          .option('vcs', {
            type: 'string',
            choices: ['git', 'svn'],
            default: 'git',
            describe: 'Version control system to use (git or svn)',
          }),
      async (args) => {
        try {
        const appsDir = args.type === 'nestjs' ? NEST_DIR : args.type === 'dotnet' ? DOTNET_DIR : NEXT_DIR;
          await init({ ...args, appsDir, projectDir: args.projectDir, vcsType: args.vcs ?? 'git' });
        } catch (error) {          Logger.error(error);
          process.exit(1);
        }
      }
    )
    .command<DeployArgs>(
      'deploy <name>',
      'Deploy or update an application',
      (yargs) =>
        yargs
          .positional('name', {
            type: 'string',
            demandOption: true,
            describe: 'The name of the application to deploy or update',
          })
          .option('force', {
            type: 'boolean',
            alias: 'f',
            default: false,
            describe: 'Force the deployment even if no changes are detected',
          })
          .option('lint', {
            type: 'boolean',
            alias: 'l',
            default: false,
            describe: 'Run linting during the deployment process',
          }),
      async (args) => {
        try {
          await deploy({
            name: args.name,
            force: args.force,
            lint: args.lint,
          });
        } catch (error) {
          Logger.error(error);
          process.exit(1);
        }
      }
    )
    .command(
      'list',
      'List all applications',
      (yargs) =>
        yargs.option('type', {
          alias: 't',
          type: 'string',
          describe: 'Filter by project type (e.g. nextjs, nestjs, dotnet)',
        }),
      async (args) => {
        await listApps(args.type as string | undefined);
      }
    ).command(
          'unlock <name>',
          'Forcefully release the lock for an application by killing its process.',
          (yargs) =>
            yargs.positional('name', {
              type: 'string',
              demandOption: true,
              describe: 'The name of the application',
            }),
           (args) => {
            try {
               unlock(args);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'clean <name>',
          'Clean app directory from local changes.',
          (yargs) =>
            yargs.positional('name', {
              type: 'string',
              demandOption: true,
              describe: 'The name of the application',
            }),
          async (args) => {
            try {
              await clean(args);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )  .command(
          'set-env <name> [env]',
          'Set an env var (KEY=VALUE), or launch interactive editor when no KEY=VALUE is given',
          (yargs) =>
            yargs
              .positional('name', {
                type: 'string',
                demandOption: true,
                describe: 'The name of the application',
              })
              .positional('env', {
                type: 'string',
                describe:
                  'Environment variable in the format VAR_NAME=VALUE (omit to open the interactive editor)',
              }),
          async (args) => {
            const { name, env } = args as { name: string; env?: string };

            if (!env) {
              // No KEY=VALUE arg — launch interactive TUI editor
              await launchEnvEditorForApp(name);
              return;
            }

            // Non-interactive path — existing behavior, untouched
            const [envName, envValue] = env.split('=');
            if (!envName || envValue === undefined) {
              Logger.error(
                `Invalid format for environment variable. Expected format: VAR_NAME=VALUE`
              );
              return;
            }
            await setEnvForApp({ name, envName, envValue });
          }
        )
        .command(
          "delete <name> <secret>",
          "Delete an application",
          (yargs) =>
            yargs.positional("name", {
              type: "string",
              demandOption: true,
              describe: "The name of the application",
            })
            .positional("secret", {
              type: "string",
              demandOption: true,
              describe: "The secret key",
            }),
          async (args) => {
            if(args.secret!==SECRET_KEY){
              Logger.error("Invalid secret key");
              process.exit(1);
            }
            await Delete(args);
          }
        )
        .command(
          'start-all',
          'Start all applications',
          (yargs) => yargs,
          async () => {
            try {
              await startAllApplications();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          "stop-all",
          "Stop all applications",
          (yargs) => yargs,
          async () => {
            try {
              await stopAllApplications();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          'clean-all',
          'Clean all apps: discard uncommitted changes and prune old builds',
          (yargs) => yargs,
          async () => {
            try {
              await cleanAll();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          'update',
          'Update the dm tool',
          (yargs) => yargs,
          async () => {
            try {
              await update();
            } catch (error) {
              Logger.error(error);
              process.exit(1);
            }
          }
        )
        .command(
          'info <name>',
          'Show detailed info about an application',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          async (args) => {
            try {
              await info(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'restart <name>',
          'Restart an application using its active build',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          async (args) => {
            try {
              await restart(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'stop <name>',
          'Stop a running application',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          async (args) => {
            try {
              await stop(args as any);
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'rollback <name>',
          'Roll back an application to a previous build',
          (yargs) =>
            yargs
              .positional('name', { type: 'string', demandOption: true, describe: 'Application name' })
              .option('to', { type: 'number', describe: 'Build index to roll back to (default: previous)' }),
          async (args) => {
            try {
              await rollback({ name: args.name as string, to: args.to });
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'logs <name>',
          'Stream live logs for an application',
          (yargs) =>
            yargs.positional('name', { type: 'string', demandOption: true, describe: 'Application name' }),
          (args) => {
            try {
              logs(args as any);
              return new Promise(() => {}); // keep process alive — child owns the lifecycle
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'monit',
          'Open the operational dashboard (alias: dashboard)',
          (yargs) => yargs,
          async () => {
            try {
              await dashboard();
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'dashboard',
          'Open the operational TUI dashboard',
          (yargs) => yargs,
          async () => {
            try {
              await dashboard();
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'storage',
          'Manage persistent storage volumes',
          (yargs) => {
            return yargs
              .command(
                'new <name> <link-name>',
                'Create a new storage',
                (yargs) =>
                  yargs
                    .positional('name', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The storage directory name (e.g. metalunic-storage)',
                    })
                    .positional('link-name', {
                      type: 'string',
                      demandOption: false,
                      describe: 'The symlink name created inside each build directory (defaults to name if not provided)',
                    }),
                async (args) => {
                  try {
                    await storageNew(args.name as string, args['link-name'] as string | undefined);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'attach <app> <storage>',
                'Attach a storage to an app',
                (yargs) =>
                  yargs
                    .positional('app', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The name of the application',
                    })
                    .positional('storage', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The name of the storage to attach',
                    }),
                async (args) => {
                  try {
                    await storageAttach(args.app as string, args.storage as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'detach <app> <storage>',
                'Detach a storage from an app',
                (yargs) =>
                  yargs
                    .positional('app', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The name of the application',
                    })
                    .positional('storage', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The name of the storage to detach',
                    }),
                async (args) => {
                  try {
                    await storageDetach(args.app as string, args.storage as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'rm <name>',
                'Delete a storage',
                (yargs) =>
                  yargs.positional('name', {
                    type: 'string',
                    demandOption: true,
                    describe: 'The name of the storage to delete',
                  }),
                async (args) => {
                  try {
                    await storageRm(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'ls',
                'List all storages',
                (yargs) => yargs,
                async () => {
                  try {
                    await storageLs();
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .demandCommand(1);
          }
        )
        .command(
          'domain',
          'Manage reverse proxy domains',
          (yargs) => {
            return yargs
              .command(
                'add <name>',
                'Add a new domain',
                (yargs) =>
                  yargs.positional('name', {
                    type: 'string',
                    demandOption: true,
                    describe: 'The domain name to add',
                  }),
                async (args) => {
                  try {
                    await domainAdd(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'remove <name>',
                'Remove a domain',
                (yargs) =>
                  yargs
                    .positional('name', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The domain name to remove',
                    })
                    .option('force', {
                      type: 'boolean',
                      default: false,
                      describe: 'Cascade delete all routes for this domain',
                    }),
                async (args) => {
                  try {
                    await domainRemove(args.name as string, args.force as boolean);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'list',
                'List all domains',
                (yargs) => yargs,
                async () => {
                  try {
                    await domainList();
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'show <name>',
                'Show details for a domain',
                (yargs) =>
                  yargs.positional('name', {
                    type: 'string',
                    demandOption: true,
                    describe: 'The domain name to show',
                  }),
                async (args) => {
                  try {
                    await domainShow(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'set-cert <name>',
                'Attach an SSL certificate to a domain',
                (yargs) =>
                  yargs
                    .positional('name', { type: 'string', demandOption: true, describe: 'The domain name' })
                    .option('cert', { type: 'string', describe: 'Path to certificate file (any extension)' })
                    .option('key', { type: 'string', describe: 'Path to private key file (any extension)' })
                    .option('pfx', { type: 'string', describe: 'Path to PFX/PKCS#12 bundle (any extension)' })
                    .option('password', { type: 'string', describe: 'Password for PFX bundle (use "" for empty)' })
                    .option('force', { type: 'boolean', default: false, describe: 'Attach certificate even if it does not cover the domain name' }),
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
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'cert-status <name>',
                'Show SSL certificate status for a domain',
                (yargs) =>
                  yargs.positional('name', { type: 'string', demandOption: true, describe: 'The domain name' }),
                async (args) => {
                  try {
                    await domainCertStatus(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'remove-cert <name>',
                'Remove the SSL certificate from a domain',
                (yargs) =>
                  yargs.positional('name', { type: 'string', demandOption: true, describe: 'The domain name' }),
                async (args) => {
                  try {
                    await domainRemoveCert(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'reload-certs [name]',
                'Reload certificates from disk for all domains or a specific domain',
                (yargs) =>
                  yargs.positional('name', { 
                    type: 'string', 
                    describe: 'The domain name (omit to reload all domains)' 
                  }),
                async (args) => {
                  try {
                    await domainReloadCerts(args.name as string | undefined);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'set-header <name>',
                'Set or update an HTTP response header on a domain',
                (yargs) =>
                  yargs
                    .positional('name', { type: 'string', demandOption: true, describe: 'The domain name' })
                    .option('key', { type: 'string', demandOption: true, describe: 'Header name' })
                    .option('value', { type: 'string', demandOption: true, describe: 'Header value' }),
                async (args) => {
                  try {
                    await domainSetHeader(args.name as string, args.key as string, args.value as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'remove-header <name>',
                'Remove an HTTP response header from a domain',
                (yargs) =>
                  yargs
                    .positional('name', { type: 'string', demandOption: true, describe: 'The domain name' })
                    .option('key', { type: 'string', demandOption: true, describe: 'Header name to remove' }),
                async (args) => {
                  try {
                    await domainRemoveHeader(args.name as string, args.key as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'compile <name>',
                'Compile and write the Nginx config for a domain',
                (yargs) =>
                  yargs.positional('name', { type: 'string', demandOption: true, describe: 'The domain name' }),
                async (args) => {
                  try {
                    await domainCompile(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'show-config <name>',
                'Preview the Nginx config for a domain without writing to disk',
                (yargs) =>
                  yargs.positional('name', { type: 'string', demandOption: true, describe: 'The domain name' }),
                async (args) => {
                  try {
                    await domainShowConfig(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'push <name>',
                'Push compiled domain config to Nginx (local or remote). Env vars: NGINX_REMOTE_HOST, NGINX_REMOTE_KEY, PUSH_CERT_DIR',
                (yargs) =>
                  yargs.positional('name', { type: 'string', demandOption: true, describe: 'The domain name' }),
                async (args) => {
                  try {
                    await domainPush(args.name as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .demandCommand(1);
          }
        )
        .command(
          'route',
          'Manage reverse proxy routes',
          (yargs) => {
            return yargs
              .command(
                'add <appName> <domainName>',
                'Add a route for an app on a domain',
                (yargs) =>
                  yargs
                    .positional('appName', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The name of the application',
                    })
                    .positional('domainName', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The domain name',
                    })
                    .option('location', {
                      type: 'string',
                      alias: 'l',
                      default: '',
                      describe: 'Route path without leading slash (e.g. "api", "admin/dashboard"). Root = omit or leave empty.',
                    })
                    .option('force', {
                      type: 'boolean',
                      alias: 'f',
                      default: false,
                      describe: 'Allow routing the app even if it is already routed elsewhere',
                    }),
                async (args) => {
                  try {
                    await routeAdd(args.appName as string, args.domainName as string, args.location as string, args.force as boolean);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'remove <domainName>',
                'Remove a route from a domain',
                (yargs) =>
                  yargs
                    .positional('domainName', {
                      type: 'string',
                      demandOption: true,
                      describe: 'The domain name',
                    })
                    .option('location', {
                      type: 'string',
                      alias: 'l',
                      default: '',
                      describe: 'Route path without leading slash (e.g. "api"). Root = omit or leave empty.',
                    }),
                async (args) => {
                  try {
                    await routeRemove(args.domainName as string, args.location as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'list <domainName>',
                'List all routes for a domain',
                (yargs) =>
                  yargs.positional('domainName', {
                    type: 'string',
                    demandOption: true,
                    describe: 'The domain name',
                  }),
                async (args) => {
                  try {
                    await routeList(args.domainName as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'set-header <domainName>',
                'Set or update an HTTP response header on a route',
                (yargs) =>
                  yargs
                    .positional('domainName', { type: 'string', demandOption: true, describe: 'The domain name' })
                    .option('location', { type: 'string', alias: 'l', default: '', describe: 'Route path without leading slash (e.g. "api"). Root = omit or leave empty.' })
                    .option('key', { type: 'string', demandOption: true, describe: 'Header name' })
                    .option('value', { type: 'string', demandOption: true, describe: 'Header value' }),
                async (args) => {
                  try {
                    await routeSetHeader(args.domainName as string, args.location as string, args.key as string, args.value as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .command(
                'remove-header <domainName>',
                'Remove an HTTP response header from a route',
                (yargs) =>
                  yargs
                    .positional('domainName', { type: 'string', demandOption: true, describe: 'The domain name' })
                    .option('location', { type: 'string', alias: 'l', default: '', describe: 'Route path without leading slash (e.g. "api"). Root = omit or leave empty.' })
                    .option('key', { type: 'string', demandOption: true, describe: 'Header name to remove' }),
                async (args) => {
                  try {
                    await routeRemoveHeader(args.domainName as string, args.location as string, args.key as string);
                  } catch (err) {
                    Logger.error(err);
                    process.exit(1);
                  }
                }
              )
              .demandCommand(1);
          }
        )
        .command(
          'migrate-db',
          'Migrate data from legacy db.json to SQL database',
          (yargs) => yargs,
          async () => {
            try {
              await migrateFromJSON();
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'change-repo <name>',
          'Change the repository URL for an application',
          (yargs) =>
            yargs
              .positional('name', {
                type: 'string',
                demandOption: true,
                describe: 'The name of the application',
              })
              .option('repo', {
                type: 'string',
                demandOption: true,
                alias: 'r',
                describe: 'The new repository URL',
              }),
          async (args) => {
            try {
              await changeRepo({ name: args.name, newRepo: args.repo as string });
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
        .command(
          'install-service',
          'Install auto-startup service to run "dm start-all" on boot',
          (yargs) =>
            yargs.option('uninstall', {
              type: 'boolean',
              default: false,
              describe: 'Uninstall the auto-startup service',
            }),
          async (args) => {
            try {
              await installService({ uninstall: args.uninstall });
            } catch (err) {
              Logger.error(err);
              process.exit(1);
            }
          }
        )
    .demandCommand(1, 'You must specify a command to run.')
    .strictCommands()
    .parseAsync();
} catch (err) {
  Logger.error(err);
}  
const endTime = Date.now(); // End the timer
const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Calculate time in seconds
Logger.info(`${timeTaken} seconds`);      
process.exit();
