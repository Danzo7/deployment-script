# Deployment Manager (dm)

A CLI tool for managing the full lifecycle of **Next.js**, **NestJS**, and **.NET Core** applications — from initialization and deployment to process management, reverse proxy configuration, and SSL. Built on PM2 and supports Git and SVN.

**Version 2.0+**: Now powered by Drizzle ORM with SQLite/PostgreSQL support for better performance and reliability.

---

## Table of Contents

- [Installation](#installation)
- [Database Migration](#database-migration)
- [Configuration](#configuration)
- [Core Concepts](#core-concepts)
- [Application Lifecycle](#application-lifecycle)
  - [init](#dm-init-name)
  - [deploy](#dm-deploy-name)
  - [update](#dm-update)
  - [rollback](#dm-rollback-name)
  - [delete](#dm-delete-name-secret)
- [Process Management](#process-management)
  - [start-all](#dm-start-all)
  - [stop-all](#dm-stop-all)
  - [stop](#dm-stop-name)
  - [restart](#dm-restart-name)
  - [list](#dm-list)
  - [info](#dm-info-name)
  - [logs](#dm-logs-name)
  - [monit](#dm-monit)
- [Environment Variables](#environment-variables)
  - [set-env](#dm-set-env-name-varvalue)
- [Storage Volumes](#storage-volumes)
  - [storage new](#dm-storage-new-name-link-name)
  - [storage attach](#dm-storage-attach-app-storage)
  - [storage detach](#dm-storage-detach-app-storage)
  - [storage rm](#dm-storage-rm-name)
  - [storage ls](#dm-storage-ls)
- [Domains and Reverse Proxy](#domains-and-reverse-proxy)
  - [domain add](#dm-domain-add-name)
  - [domain remove](#dm-domain-remove-name)
  - [domain list](#dm-domain-list)
  - [domain show](#dm-domain-show-name)
  - [domain set-header](#dm-domain-set-header-name)
  - [domain remove-header](#dm-domain-remove-header-name)
  - [domain compile](#dm-domain-compile-name)
  - [domain show-config](#dm-domain-show-config-name)
  - [domain push](#dm-domain-push-name)
- [SSL Certificates](#ssl-certificates)
  - [domain set-cert](#dm-domain-set-cert-name)
  - [domain cert-status](#dm-domain-cert-status-name)
  - [domain remove-cert](#dm-domain-remove-cert-name)
  - [domain reload-certs](#dm-domain-reload-certs-name)
- [Routes](#routes)
  - [route add](#dm-route-add-appname-domainname)
  - [route remove](#dm-route-remove-domainname)
  - [route list](#dm-route-list-domainname)
  - [route set-header](#dm-route-set-header-domainname)
  - [route remove-header](#dm-route-remove-header-domainname)
- [Maintenance](#maintenance)
  - [clean](#dm-clean-name)
  - [clean-all](#dm-clean-all)
  - [unlock](#dm-unlock-name)
- [Monorepo Support](#monorepo-support)
- [How It Works](#how-it-works)

---

## Installation

```bash
git clone <repository-url>
cd deployment-manager
npm install
npm run build
npm link
```

After linking, `dm` is available globally.

---

## Database Migration

**⚠️ Important for v1.x users**: Version 2.0 migrates from JSON-based storage to SQL databases (SQLite/PostgreSQL).

### First-Time Setup (New Users)

No action needed! The database will be created automatically on first use.

### Upgrading from v1.x

If you have existing apps, run the migration command:

```bash
dm migrate-db
```

This will:
- Automatically backup your `db.json` to `db.json.backup-<timestamp>`
- Migrate all apps, storages, domains, and routes to the new database
- Show migration statistics

---

## Configuration

`dm` reads a `.env` file from its own root directory. All settings have sensible defaults but can be overridden:

| Variable | Default | Description |
|---|---|---|
| `APP_DIR` | `.applications` | Root directory for all app data |
| `NEXT_DIR` | same as `APP_DIR` | Directory for Next.js apps |
| `NEST_DIR` | same as `APP_DIR` | Directory for NestJS apps |
| `DOTNET_DIR` | same as `APP_DIR` | Directory for .NET apps |
| `STORAGE_DIR` | `APP_DIR/storages` | Persistent storage volumes root |
| `DOMAINS_DIR` | `.domains` | Output directory for compiled Nginx configs |
| `PROXY_TARGET_HOST` | `127.0.0.1` | Host used in nginx `proxy_pass` directives |
| `NGINX_REMOTE_HOST` | — | Remote host for domain push (user@host format) |
| `NGINX_REMOTE_KEY` | — | SSH private key path for remote pushes |
| `NGINX_REMOTE_PASSWORD` | — | SSH password for remote pushes (takes priority over key) |
| `PUSH_CERT_DIR` | `/etc/nginx/ssl` (remote) | Target directory for SSL certificates on push |
| `SECRET_KEY` | — | Required for `dm delete` |

---

## Core Concepts

- **App** — A registered application with a name, repo, branch, port, and type.
- **Build** — A timestamped snapshot of a compiled release. Multiple builds are kept for rollback.
- **Active Build** — The build currently serving traffic. Rollback switches the active build.
- **Storage** — A persistent named directory that lives outside builds and is symlinked into every new build automatically.
- **Domain** — A hostname registered for reverse proxying with compiled Nginx configuration.
- **Route** — A mapping from a domain path to an app (e.g., `example.com/api` → `my-api`).
- **Push** — Deployment of a compiled domain config to a live Nginx installation (local or remote).
- **Stale Config** — A domain that has been recompiled since its last push, indicating the live Nginx config may be out of date.
- **Lock** — A per-app file lock that prevents concurrent operations on the same app.

---

## Application Lifecycle

### `dm init <name>`

Register a new application. This does not deploy — it records the app configuration and prepares directories.

```bash
dm init <name> --repo <url> [options]
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--repo` | `-r` | required | Git or SVN repository URL |
| `--branch` | `-b` | `main` | Branch to deploy from (or SVN path like `trunk`, `branches/x`) |
| `--instances` | `-i` | `1` | Number of PM2 cluster workers |
| `--port` | `-p` | auto | Port number (auto-assigned from 50xxx range if omitted) |
| `--type` | `-t` | `nextjs` | App type: `nextjs`, `nestjs`, or `dotnet` |
| `--project-dir` | `-d` | — | Subdirectory within the repo (for monorepos) |
| `--vcs` | — | `git` | Version control: `git` or `svn` |

```bash
# Basic Next.js app
dm init my-app --repo https://github.com/org/my-app --branch main

# NestJS with explicit port and instances
dm init my-api --repo https://github.com/org/my-api --type nestjs --port 3001 --instances 2

# .NET app
dm init my-dotnet-api --repo https://github.com/org/dotnet-app --type dotnet

# SVN repository
dm init legacy-app --repo https://svn.example.com/repo --branch trunk --vcs svn
```

After init, run `dm deploy <name>` to perform the first deployment.

---

### `dm deploy <name>`

Pull latest changes, install dependencies, build, and start or restart the app via PM2.

```bash
dm deploy <name> [--force] [--lint]
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--force` | `-f` | `false` | Force full redeploy even if nothing changed |
| `--lint` | `-l` | `false` | Run ESLint and push any auto-fixes before deploying |

**Smart change detection** — deploy exits early (no rebuild) if the git commit hash, environment variables, and app settings are all unchanged and the app is already running. Use `--force` to bypass this.

**What deploy does:**

1. Clones the repo on first deploy, or fetches and pulls latest changes
2. Detects changes (git hash, env vars, appsettings)
3. For Node.js: runs `npm install` and `npm run build`
4. For .NET: runs `dotnet restore` and `dotnet publish -c Release`
5. Creates a timestamped build snapshot
6. Symlinks attached storage volumes into the new build
7. Starts or restarts the app via PM2
8. Records the deployed commit hash and build path

```bash
dm deploy my-app
dm deploy my-app --force
dm deploy my-app --lint
```

---

### `dm update`

Update the `dm` tool itself. Pulls latest changes from its own git repo and rebuilds if source files or `package.json` changed.

```bash
dm update
```

---

### `dm rollback <name>`

Roll back an application to a previous build.

```bash
dm rollback <name> [--to <index>]
```

Running without `--to` lists all available builds and rolls back to the previous one. Use `--to <index>` to target a specific build.

```bash
# Roll back to the previous build
dm rollback my-app

# Roll back to a specific build index shown in the list
dm rollback my-app --to 2
```

The rollback switches the active build pointer, reapplies storage symlinks, and restarts the PM2 process.

---

### `dm delete <name> <secret>`

Permanently remove an application. Stops the PM2 process, deletes the app directory, and removes it from the database.

```bash
dm delete my-app <secret>
```

Requires the `SECRET_KEY` environment variable to be set. The `<secret>` argument must match it.

---

## Process Management

### `dm start-all`

Start all registered applications that are not currently running, using their last known active build.

```bash
dm start-all
```

---

### `dm stop-all`

Stop all running applications.

```bash
dm stop-all
```

---

### `dm stop <name>`

Stop a single running application without removing it.

```bash
dm stop my-app
```

---

### `dm restart <name>`

Restart an application using its current active build.

```bash
dm restart my-app
```

---

### `dm list`

Display all registered apps in a table: name, port, status, type, branch, and last deploy time.

```bash
dm list
```

---

### `dm info <name>`

Show comprehensive details about an application:

- Port, status, type, branch, directory
- PM2 details: memory usage, uptime, restart count, script path
- Last deployed commit: hash, message, author, date
- Build history with the active build highlighted
- Attached storage volumes with disk usage
- Configured routes (domain + path + SSL status)

```bash
dm info my-app
```

---

### `dm logs <name>`

Stream live PM2 logs (stdout and stderr) for an application. Press `Ctrl+C` to stop.

```bash
dm logs my-app
```

---

### `dm monit`

Open the PM2 monitoring dashboard showing CPU, memory, status, and restart count for all apps.

```bash
dm monit
```

---

## Environment Variables

### `dm set-env <name> <VAR=VALUE>`

Set or update an environment variable for an application. Written to the app's env file and picked up on the next deploy.

```bash
dm set-env my-app DATABASE_URL=postgres://localhost/mydb
dm set-env my-app API_KEY=abc123
```

- **Next.js**: written to `.env.local`
- **NestJS**: written to `.env`
- **.NET**: written to `.env` in the app's env directory (injected into the publish output on deploy)

A change in env vars triggers a rebuild on the next `dm deploy`.

---

## Storage Volumes

Persistent named directories that live outside any build directory. They survive deployments and rollbacks. A symlink is automatically created in every new build directory when a storage is attached.

### `dm storage new <name> <link-name>`

Create a new storage volume.

- `<name>` — The storage's directory name on disk (e.g., `uploads`)
- `<link-name>` — The symlink name that appears inside each build directory (e.g., `Storage`)

```bash
dm storage new uploads Storage
```

---

### `dm storage attach <app> <storage>`

Attach a storage to an app. The symlink is immediately created in the active build and in all future builds.

```bash
dm storage attach my-app uploads
```

---

### `dm storage detach <app> <storage>`

Remove a storage association from an app. The symlink is removed from the active build, but the storage directory and its contents are preserved.

```bash
dm storage detach my-app uploads
```

---

### `dm storage rm <name>`

Delete a storage entirely. Refuses if the storage is still attached to any app — detach it first.

```bash
dm storage rm uploads
```

---

### `dm storage ls`

List all storages with their path, creation date, disk usage, and which apps they are attached to.

```bash
dm storage ls
```

---

## Domains and Reverse Proxy

Domains define the hostnames your apps are accessible on. Routes map paths on a domain to specific apps. `dm` generates Nginx configuration files that you include in your Nginx setup.

### `dm domain add <name>`

Register a new domain.

```bash
dm domain add example.com
```

---

### `dm domain remove <name>`

Remove a domain. Fails if routes still exist unless `--force` is used.

```bash
dm domain remove example.com
dm domain remove example.com --force   # also removes all routes
```

---

### `dm domain list`

List all domains with route count, SSL status, and push status.

```bash
dm domain list
```

---

### `dm domain show <name>`

Show detailed information for a domain: SSL mode, certificate expiry, creation date, push status, and all configured routes.

```bash
dm domain show example.com
```

---

### `dm domain set-header <name>`

Set or update an HTTP response header applied to all routes under this domain.

```bash
dm domain set-header example.com --key X-Frame-Options --value DENY
dm domain set-header example.com --key Cache-Control --value "no-store"
```

---

### `dm domain remove-header <name>`

Remove an HTTP response header from a domain.

```bash
dm domain remove-header example.com --key X-Frame-Options
```

---

### `dm domain compile <name>`

Compile and write the Nginx configuration file for a domain to disk (into `DOMAINS_DIR`). Shows a diff if the file already exists. Re-run after any domain, route, SSL, or header change.

```bash
dm domain compile example.com
```

After compiling, push the config to Nginx with `dm domain push <name>` to make it live.

---

### `dm domain show-config <name>`

Preview the Nginx configuration that would be generated, without writing to disk.

```bash
dm domain show-config example.com
```

---

### `dm domain push <name>`

Deploy the compiled Nginx configuration to a live Nginx installation. Pushes the config to `/etc/nginx/sites-available/`, creates symlinks, copies SSL certificates (if configured), validates the configuration, and reloads Nginx.

```bash
dm domain push example.com
```

**Local vs Remote Push:**

- **Local**: Pushes directly to Nginx on the same machine using filesystem operations
- **Remote**: Pushes to a remote Nginx server via SCP and SSH

The target is determined by the `NGINX_REMOTE_HOST` environment variable. If set, pushes go to that remote host. Otherwise, the push is local.

**Push Workflow:**

1. Compiles the domain config fresh with actual cert paths from DB
2. If PUSH_CERT_DIR is set (or defaults to /etc/nginx/ssl for remote), rewrites cert paths in config
3. Transfers the config file to `/etc/nginx/sites-available/<domainName>.conf`
4. Copies SSL certificates to target directory (if SSL is enabled)
5. Creates a symlink in `/etc/nginx/sites-enabled/`
6. Validates the complete Nginx config with `nginx -t`
7. Reloads Nginx to apply changes
8. Updates domain metadata (lastPushedAt, configPath)
9. Rolls back on any failure to keep Nginx in a known-good state

**Environment Variables:**

| Variable | Default | Description |
|---|---|---|
| `NGINX_REMOTE_HOST` | — | Remote host for push (user@host format). If not set, pushes locally |
| `NGINX_REMOTE_PASSWORD` | — | SSH password for remote pushes. If set, password auth is used |
| `NGINX_REMOTE_KEY` | — | SSH private key path for remote pushes. Used if no password is set |
| `PUSH_CERT_DIR` | `/etc/nginx/ssl` (remote only) | Target directory for SSL certificates. Local: optional, Remote: defaults to /etc/nginx/ssl |

```bash
# Push locally (uses cert paths from DB as-is)
dm domain push example.com

# Push locally with cert copying
export PUSH_CERT_DIR=/etc/nginx/ssl
dm domain push example.com

# Push to remote with password authentication
export NGINX_REMOTE_HOST=user@nginx-server.com
export NGINX_REMOTE_PASSWORD=your-password
# PUSH_CERT_DIR defaults to /etc/nginx/ssl for remote
dm domain push example.com

# Push to remote with custom cert directory
export NGINX_REMOTE_HOST=user@nginx-server.com
export NGINX_REMOTE_KEY=/path/to/key.pem
export PUSH_CERT_DIR=/opt/ssl/certs
dm domain push example.com
```

**Rollback:** If any step fails after files are written (validation fails, reload fails, etc.), the push automatically rolls back by removing the newly written config and symlink, restoring the previous state.

**Note:** Push always compiles the config fresh before deploying, so you don't need to run `dm domain compile` separately. The standalone compile command is still useful for inspecting the generated config before deployment.

---

## SSL Certificates

### `dm domain set-cert <name>`

Attach an SSL certificate to a domain. Supports two formats:

**PEM format** (separate certificate and key files):

```bash
dm domain set-cert example.com --cert /path/to/cert.pem --key /path/to/key.pem
```

**PFX/PKCS#12 format** (single bundle, common from Windows/IIS exports):

```bash
dm domain set-cert example.com --pfx /path/to/cert.pfx --password "your-password"
dm domain set-cert example.com --pfx /path/to/cert.pfx --password ""   # empty password
```

| Option | Description |
|---|---|
| `--cert` | Path to certificate file |
| `--key` | Path to private key file |
| `--pfx` | Path to PFX/PKCS#12 bundle |
| `--password` | Password for PFX bundle |
| `--force` | Attach even if the cert does not cover the domain name |

The tool validates that:
- The certificate is not expired
- The private key matches the certificate
- The certificate covers the domain name or its SANs (bypass with `--force`)

After attaching a cert, recompile the domain config:

```bash
dm domain compile example.com
```

---

### `dm domain cert-status <name>`

Show SSL certificate status: validity dates, expiry, issued-to, and issuer.

```bash
dm domain cert-status example.com
```

---

### `dm domain remove-cert <name>`

Remove the SSL certificate from a domain. The domain reverts to HTTP-only mode.

```bash
dm domain remove-cert example.com
```

---

### `dm domain reload-certs [name]`

Reload certificates from disk and synchronize with the database. This command scans the certificate storage folder for each domain and updates the database accordingly.

**Behavior:**
- If cert and key files exist on disk but not in DB → adds certificate to DB
- If cert and key files exist on disk and in DB → updates certificate metadata in DB
- If certificate exists in DB but files missing on disk → warns and removes SSL from domain

**Use cases:**
- Easy way to load certificates after manual file placement in the certificate folder
- Refresh certificate metadata after manual certificate replacement
- Detect and fix mismatches between filesystem and database state

```bash
# Reload certificates for a specific domain
dm domain reload-certs example.com

# Reload certificates for all domains
dm domain reload-certs
```

**Certificate Storage Location:**  
Certificates are stored in: `<DOMAINS_DIR>/<domain-name>/ssl/`
- `cert.pem` - SSL certificate
- `key.pem` - Private key

---

## Routes

Routes map a path on a domain to a specific application. The app must be registered with `dm init` before adding a route.

Paths are stored **without** a leading `/`. The slash is prepended automatically when displaying routes and generating Nginx config. Pass `api`, not `/api`.

### `dm route add <appName> <domainName>`

Add a route for an app on a domain.

```bash
# Route the root (/) to my-app -- omit --location
dm route add my-app example.com

# Route /api to my-api
dm route add my-api example.com --location api

# Route /admin/dashboard to my-admin
dm route add my-admin example.com --location admin/dashboard
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--location` | `-l` | `""` (root) | Path without leading slash -- e.g. `api`, `admin/dashboard` |
| `--force` | `-f` | `false` | Allow routing even if the app is already routed elsewhere |

More specific paths take priority over less specific ones in the generated Nginx config.

---

### `dm route remove <domainName>`

Remove a route from a domain by location.

```bash
dm route remove example.com --location api
dm route remove example.com   # removes the root route
```

---

### `dm route list <domainName>`

List all routes configured for a domain.

```bash
dm route list example.com
```

---

### `dm route set-header <domainName>`

Set or update an HTTP response header for a specific route. Route headers override domain-level headers for the same key.

```bash
dm route set-header example.com --location api --key X-API-Version --value "2"
```

---

### `dm route remove-header <domainName>`

Remove an HTTP response header from a specific route.

```bash
dm route remove-header example.com --location api --key X-API-Version
```

---

## Maintenance

### `dm clean <name>`

Discard uncommitted local git changes in the app's working directory and remove all old builds, keeping only the active one.

```bash
dm clean my-app
```

---

### `dm clean-all`

Run `clean` for every registered application.

```bash
dm clean-all
```

---

### `dm unlock <name>`

Force-release a stuck per-app lock by killing the associated process. Use this if a `dm` command was interrupted and left an app locked.

```bash
dm unlock my-app
```

---

## Monorepo Support

If your repo contains multiple projects (e.g., a shared library alongside `PublicApi/` and `AdminApi/` directories), use `--project-dir` on init to point `dm` at the specific subdirectory.

```bash
# Two .NET projects from the same repo
dm init public-api --repo https://github.com/org/monorepo --type dotnet --project-dir PublicApi
dm init admin-api  --repo https://github.com/org/monorepo --type dotnet --project-dir AdminApi

# Node.js monorepo
dm init frontend --repo https://github.com/org/monorepo --type nextjs --project-dir apps/web
```

The repo is always cloned at its root. `--project-dir` only affects where builds run and where artifacts are expected.

---

## How It Works

### Deployment pipeline

```
dm init       → register app, create directories
dm deploy     → clone/pull → detect changes → build → snapshot → link storages → PM2 start/restart
dm rollback   → switch active build → reapply storage symlinks → PM2 restart
```

### Build versioning

Each deployment creates a timestamped build directory (`builds/build-<timestamp>/`). The database tracks all builds and the currently active one. Old builds are pruned asynchronously after a successful deploy.

### Process management

Apps run under PM2:
- **Next.js / NestJS** — cluster mode, scaled by `--instances`
- **.NET** — fork mode (single process), `dotnet <appName>.dll`

Log files land in `<APP_DIR>/<name>/logs/`.

### Nginx integration

`dm` generates Nginx server block configurations and can deploy them automatically to local or remote Nginx installations.

**Configuration workflow:**

```
dm domain add      → register domain
dm route add       → map paths to apps
dm domain compile  → generate Nginx config
dm domain push     → deploy to live Nginx
```

**Push deployment:**

The push command handles the complete deployment lifecycle:
- Transfers compiled config to `/etc/nginx/sites-available/`
- Copies SSL certificates to the target (if configured)
- Creates symlinks in `/etc/nginx/sites-enabled/`
- Validates with `nginx -t` before committing
- Reloads Nginx to apply changes
- Tracks deployment metadata (timestamps, paths, staleness)
- Automatically rolls back on any failure

**Local vs remote:**

- **Local push**: Direct filesystem operations on the same machine
- **Remote push**: Uses SCP for file transfer and SSH for command execution

Configure remote targets via environment variables (`NGINX_REMOTE_HOST`, `NGINX_REMOTE_PASSWORD` or `NGINX_REMOTE_KEY`). Password authentication takes priority if both are set.

**Config compilation:**

Push always compiles the config fresh before deployment using actual cert paths from the database. The standalone `dm domain compile` command is useful for inspecting the generated config without deploying it.

**Generated config features:**

- HTTP to HTTPS redirects
- `www` to apex redirects for apex domains
- TLSv1.2 / TLSv1.3 with session caching
- gzip for common content types
- Per-route and per-domain custom headers
- Project-type-specific proxy settings (WebSocket upgrade for Next.js, etc.)

### Locking

Each app has a file-based lock preventing concurrent `dm` operations on the same app. The lock is released automatically on exit or SIGINT. Use `dm unlock <name>` if a lock gets stuck.

### VCS support

| Feature | Git | SVN |
|---|---|---|
| First deploy | `git clone` | `svn checkout` |
| Update | `git fetch` + `git pull` | `svn update` |
| Change detection | commit hash | revision number |
| Lint auto-push | supported (`--lint`) | not supported |
| Branch syntax | branch name | `trunk`, `branches/x`, `tags/x` |
