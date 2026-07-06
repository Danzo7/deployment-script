// ─── REPL Command Documentation ───────────────────────────────────────────────
// Single source of truth for all REPL commands: used to generate help text
// and tab-completion lists.

export interface CommandDoc {
  /** The command name as typed by the user */
  name: string;
  /** Short one-line description */
  description: string;
  /** Usage signature shown in help */
  usage: string;
  /** Optional subcommands (e.g. for storage, domain, route) */
  subcommands?: SubcommandDoc[];
}

export interface SubcommandDoc {
  name: string;
  usage: string;
  description: string;
}

export const COMMAND_GROUPS: { label: string; commands: CommandDoc[] }[] = [
  {
    label: 'App lifecycle',
    commands: [
      {
        name: 'init',
        description: 'Initialize a new application',
        usage: 'init <name> --repo <url> [--branch b] [--port n] [--instances n] [--type nextjs|nestjs|dotnet] [--project-dir d] [--vcs git|svn|local]',
      },
      {
        name: 'deploy',
        description: 'Deploy or update an application',
        usage: 'deploy <name> [--force] [--lint]',
      },
      {
        name: 'restart',
        description: 'Restart an application using its active build',
        usage: 'restart <name>',
      },
      {
        name: 'stop',
        description: 'Stop a running application',
        usage: 'stop <name>',
      },
      {
        name: 'rollback',
        description: 'Roll back an application to a previous build',
        usage: 'rollback <name> [--to <index>]',
      },
      {
        name: 'start-all',
        description: 'Start all applications',
        usage: 'start-all',
      },
      {
        name: 'stop-all',
        description: 'Stop all applications',
        usage: 'stop-all',
      },
      {
        name: 'delete',
        description: 'Delete an application (requires secret key)',
        usage: 'delete <name> <secret>',
      },
    ],
  },
  {
    label: 'Info & monitoring',
    commands: [
      {
        name: 'list',
        description: 'List all applications',
        usage: 'list [--type nextjs|nestjs|dotnet]',
      },
      {
        name: 'info',
        description: 'Show detailed info about an application',
        usage: 'info <name>',
      },
      {
        name: 'logs',
        description: 'Stream live logs for an application',
        usage: 'logs <name>',
      },
      {
        name: 'monit',
        description: 'Open the operational dashboard (alias: dashboard)',
        usage: 'monit',
      },
      {
        name: 'dashboard',
        description: 'Open the operational TUI dashboard',
        usage: 'dashboard',
      },
    ],
  },
  {
    label: 'Environment',
    commands: [
      {
        name: 'set-env',
        description: 'Set an env var (KEY=VALUE), or launch interactive editor when no value is given',
        usage: 'set-env <name> [KEY=VALUE]',
      },
      {
        name: 'unlock',
        description: 'Forcefully release the lock for an application',
        usage: 'unlock <name>',
      },
      {
        name: 'clean',
        description: 'Clean app directory from local changes',
        usage: 'clean <name>',
      },
      {
        name: 'clean-all',
        description: 'Clean all apps: discard uncommitted changes and prune old builds',
        usage: 'clean-all',
      },
      {
        name: 'update',
        description: 'Update the dm tool',
        usage: 'update',
      },
    ],
  },
  {
    label: 'Storage',
    commands: [
      {
        name: 'storage',
        description: 'Manage persistent storage volumes',
        usage: 'storage <subcommand>',
        subcommands: [
          { name: 'new',    usage: 'storage new <name> [link-name]',       description: 'Create a new storage volume' },
          { name: 'attach', usage: 'storage attach <app> <storage>',       description: 'Attach a storage to an app' },
          { name: 'detach', usage: 'storage detach <app> <storage>',       description: 'Detach a storage from an app' },
          { name: 'rm',     usage: 'storage rm <name>',                    description: 'Delete a storage volume' },
          { name: 'ls',     usage: 'storage ls',                           description: 'List all storage volumes' },
        ],
      },
    ],
  },
  {
    label: 'Domain',
    commands: [
      {
        name: 'domain',
        description: 'Manage reverse proxy domains',
        usage: 'domain <subcommand>',
        subcommands: [
          { name: 'add',           usage: 'domain add <name>',                                                    description: 'Add a new domain' },
          { name: 'remove',        usage: 'domain remove <name> [--force]',                                       description: 'Remove a domain' },
          { name: 'list',          usage: 'domain list',                                                          description: 'List all domains' },
          { name: 'show',          usage: 'domain show <name>',                                                   description: 'Show details for a domain' },
          { name: 'set-cert',      usage: 'domain set-cert <name> --cert <f> --key <f> | --pfx <f> --password <p>', description: 'Attach an SSL certificate to a domain' },
          { name: 'cert-status',   usage: 'domain cert-status <name>',                                            description: 'Show SSL certificate status for a domain' },
          { name: 'remove-cert',   usage: 'domain remove-cert <name>',                                            description: 'Remove the SSL certificate from a domain' },
          { name: 'reload-certs',  usage: 'domain reload-certs [name]',                                           description: 'Reload certificates from disk' },
          { name: 'set-header',    usage: 'domain set-header <name> --key <k> --value <v>',                       description: 'Set or update an HTTP response header on a domain' },
          { name: 'remove-header', usage: 'domain remove-header <name> --key <k>',                                description: 'Remove an HTTP response header from a domain' },
          { name: 'compile',       usage: 'domain compile <name>',                                                description: 'Compile the Nginx config for a domain' },
          { name: 'show-config',   usage: 'domain show-config <name>',                                            description: 'Preview the Nginx config without writing to disk' },
          { name: 'push',          usage: 'domain push <name>',                                                   description: 'Push compiled domain config to Nginx' },
        ],
      },
    ],
  },
  {
    label: 'Route',
    commands: [
      {
        name: 'route',
        description: 'Manage reverse proxy routes',
        usage: 'route <subcommand>',
        subcommands: [
          { name: 'add',           usage: 'route add <appName> <domainName> [--location path] [--force]', description: 'Add a route for an app on a domain' },
          { name: 'remove',        usage: 'route remove <domainName> [--location path]',                  description: 'Remove a route' },
          { name: 'list',          usage: 'route list <domainName>',                                      description: 'List routes for a domain' },
          { name: 'set-header',    usage: 'route set-header <domainName> --key <k> --value <v> [--location path]', description: 'Set an HTTP header on a route' },
          { name: 'remove-header', usage: 'route remove-header <domainName> --key <k> [--location path]', description: 'Remove an HTTP header from a route' },
        ],
      },
    ],
  },
  {
    label: 'Database & misc',
    commands: [
      {
        name: 'migrate-db',
        description: 'Migrate data from legacy db.json to the SQL database',
        usage: 'migrate-db',
      },
      {
        name: 'change-repo',
        description: 'Change the repository URL for an application',
        usage: 'change-repo <name> --repo <url>',
      },
      {
        name: 'install-service',
        description: 'Install (or uninstall) the dm system service',
        usage: 'install-service [--uninstall]',
      },
    ],
  },
  {
    label: 'Shell',
    commands: [
      { name: 'help',  description: 'Show this help',       usage: 'help' },
      { name: 'clear', description: 'Clear the screen',     usage: 'clear' },
      { name: 'exit',  description: 'Exit the shell',       usage: 'exit' },
      { name: 'quit',  description: 'Exit the shell',       usage: 'quit' },
    ],
  },
];

// ─── Derived helpers ───────────────────────────────────────────────────────────

/** Flat list of all top-level command names — used for tab-completion */
export const TOP_LEVEL_COMMANDS: string[] = COMMAND_GROUPS.flatMap((g) =>
  g.commands.map((c) => c.name),
);
