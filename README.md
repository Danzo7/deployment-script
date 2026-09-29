# dm — Deployment Manager

A powerful CLI tool and interactive shell for deploying and managing applications on your server. **dm** supports Next.js, NestJS, .NET, and static applications with PM2 process management, nginx reverse proxy configuration, PostgreSQL schema migrations, a full-featured TUI dashboard, and a built-in SSH remote access server.

---

## Table of Contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Project Types](#project-types)
- [Interactive Shell (REPL)](#interactive-shell-repl)
- [App Lifecycle](#app-lifecycle)
- [Environment Variables](#environment-variables)
- [Persistent Storage](#persistent-storage)
- [Nginx & Reverse Proxy](#nginx--reverse-proxy)
- [TUI Dashboard](#tui-dashboard)
- [Database Management](#database-management)
- [Remote Access (SSH Server)](#remote-access-ssh-server)
- [dm-connect (Windows Client)](#dm-connect-windows-client)
- [Monitoring & Logs](#monitoring--logs)
- [Utilities](#utilities)
- [Configuration Reference](#configuration-reference)

---

## Overview

**dm** (Deployment Manager) is a comprehensive application deployment and management tool that:

- **Deploys and manages** Next.js, NestJS, .NET, and static applications
- **Automates builds** with intelligent change detection and caching
- **Manages nginx** reverse proxy configuration as code with SSL/TLS support
- **Provides a TUI dashboard** for real-time monitoring and management
- **Offers PostgreSQL schema migration** tools with step-by-step migration plans
- **Includes SSH remote access** for secure remote management
- **Tracks deployments** with automatic rollback capabilities

---

## Requirements

| Component             | Requirement                                        |
| --------------------- | -------------------------------------------------- |
| Runtime               | Node.js 22+ (< 25)                                 |
| Process manager       | PM2 (installed globally)                           |
| Version control       | git, svn, or a local folder path                   |
| Nginx (reverse proxy) | Linux machine with nginx installed and sudo access |
| .NET apps             | .NET 8 SDK                                         |
| Remote SSH client     | OpenSSH client (`ssh` command available)           |
| PFX cert extraction   | `openssl` command available                        |
| Database (optional)   | PostgreSQL 12+ for database migration features     |

### Platform Notes

- **Windows users:** If you encounter errors related to `better-sqlite3` during installation, you may need to install Windows Build Tools:
  ```bash
  npm install --global windows-build-tools
  ```
  Or use Node.js 22+ which has better prebuilt binary support.

- **Nginx operations:** Require Linux. dm can be installed on any OS for app management (deploy, env, logs, etc.), but `domain push` only succeeds when nginx is reachable — either locally on Linux, or via a remote Linux host over SSH.

---

## Installation

Install dm globally via npm:

```bash
npm install -g https://github.com/Danzo7/deployment-script
```

On first run, dm automatically creates its data directory structure based on your operating system:

**Linux:** `/opt/deployment-manager/`  
**Windows:** `C:\ProgramData\deployment-manager\`  
**Override:** Set `DM_ROOT` environment variable to use a custom location

The directory structure:
```
/opt/deployment-manager/  (or C:\ProgramData\deployment-manager\)
├── .env              # Configuration file (auto-created)
├── applications/     # Deployed apps and builds
├── domains/          # Nginx configs and SSL certificates
├── locks/            # Runtime lock files
└── remote/           # SSH server keys and audit logs
```

All paths are customizable via the `.env` file. See [Configuration Reference](#configuration-reference) for details.

---

## Getting Started

### Quick Start

1. **Start the interactive shell:**
   ```bash
   dm
   ```

2. **Initialize an application:**
   ```bash
   dm init my-app --repo https://github.com/user/repo --branch main
   ```

3. **Deploy the application:**
   ```bash
   dm deploy my-app
   ```

4. **Open the dashboard:**
   ```bash
   dm dashboard
   ```

### Common Workflow

```bash
# Initialize and deploy an app
dm init my-nextjs-app --repo git@github.com:user/nextjs-app.git
dm deploy my-nextjs-app

# Configure environment variables
dm set-env my-nextjs-app

# Set up a domain and route
dm domain add example.com
dm route add my-nextjs-app example.com

# Configure SSL certificate
dm domain set-cert example.com --cert /path/to/cert.pem --key /path/to/key.pem

# Push nginx configuration
dm domain push example.com

# Monitor the application
dm dashboard
```

---

## Project Types

dm supports four application types with automatic detection and type-specific build processes:

| Type     | Build Tool     | PM2 Mode | Entry Point                        | Detection                      |
| -------- | -------------- | -------- | ---------------------------------- | ------------------------------ |
| `nextjs` | npm run build  | cluster  | next start                         | `next.config.*` or `next` dep  |
| `nestjs` | npm run build  | cluster  | dist/main.js                       | `@nestjs/core` dep             |
| `dotnet` | dotnet publish | fork     | dotnet \<app\>.dll                 | `.csproj` file                 |
| `static` | none           | cluster  | built-in static server (sirv)      | `dist/` or `build/` directory  |

### Type-Specific Behavior

#### Next.js

- Runs via `next start` in **cluster mode** (supports multiple instances)
- Build creates a snapshot containing:
  - `.next/` folder (copied)
  - `node_modules/` (symlinked for fast deploys)
  - `next.config.*`, `.env.local`, `public/`
- Preserves `content/` folder across builds (for CMS-managed content)
- Nginx gets WebSocket upgrade headers automatically
- Environment file: `env/.env.local`

#### NestJS

- Runs `dist/main.js` in **cluster mode**
- Build creates a snapshot containing:
  - `dist/` (copied)
  - `node_modules/` (symlinked)
  - `package.json`, `.env`, `.env.production`
- Validates `dist/main.js` exists before starting
- Environment file: `env/.env`

#### .NET

- Runs in **fork mode** (single instance only)
- `dotnet publish` outputs to `publish/` subfolder
- Validates SDK version against `global.json`
- Validates assembly name matches app name
- `--instances` flag is ignored (not supported)
- `--node-args` has no effect
- Environment files: `appsettings.json`, `appsettings.Production.json`

#### Static

- No build step required
- Expects pre-built output in `dist/` or `build/` folder
- Throws error if `package.json` is present (prevents accidental serving of unbuild source)
- Served by built-in Node.js static file server (sirv)
- Supports multiple instances in cluster mode
- No environment file sync

### Auto-Detection

When you run `dm init` without `--type`, dm automatically detects the project type by:

1. Cloning the repository to a temporary staging directory
2. Running detection logic with confidence scores (0-100)
3. Selecting the type with the highest score (must be > 50)
4. Prompting for user selection if ambiguous (top two scores within 10 points)
5. Cleaning up the staging directory

**Detection scores:**

| Signal                              | Type     | Score |
| ----------------------------------- | -------- | ----- |
| `next.config.*` present             | nextjs   | 95    |
| `next` in package.json deps         | nextjs   | 80    |
| `@nestjs/core` + `nest-cli.json`    | nestjs   | 95    |
| `@nestjs/core` only                 | nestjs   | 90    |
| `.csproj` file                      | dotnet   | 95    |
| `global.json`                       | dotnet   | 60    |
| `dist/index.html` or `build/index.html` | static | 85  |
| `index.html` at root                | static   | 70    |

**VCS auto-detection:** If `--vcs` is omitted, dm inspects the URL:
- Local filesystem path → `local`
- URL hints (`git@`, `.git`, `svn://`, `/trunk/`) → detected VCS
- Remote probe to confirm detection
- Throws error if detection fails (pass `--vcs` explicitly)

---

## Interactive Shell (REPL)

Running `dm` with no arguments starts an interactive shell with:

- **Tab completion** for commands and arguments
- **Command history** (persistent across sessions)
- **Inline help** with `help` command
- **Command palette** with `:` key
- **All CLI commands available** (except CLI-only commands)

```
$ dm
Deployment Manager v2.0.0
Type "help" for available commands.

dm> help
dm> deploy my-app
dm> set-env my-app
dm> logs my-app
dm> dashboard
```

### Special Behaviors

- **TUI integration:** When launching TUIs (dashboard, editors), the REPL suspends and resumes cleanly
- **Remote sessions:** When connected via SSH, the env var `DM_REMOTE_USER` is set
- **Command restrictions:**
  - **CLI-only commands** (not available in REPL): `delete`, `migrate-db`, `change-repo`, `install-service`, `update`
  - **Remote session restrictions** (additional): `remote`, `update`, `install-service`, `migrate-db`
- **Audit logging:** All commands in remote sessions are logged to `.remote/audit.log`

---

## App Lifecycle

### Initialize an Application

Register a new application in the database (does not deploy):

```bash
dm init <name> --repo <url> [options]
```

**Options:**

| Option              | Default      | Description                                   |
| ------------------- | ------------ | --------------------------------------------- |
| `--repo, -r`        | required     | Repository URL (git/svn) or local folder path |
| `--branch, -b`      | main         | Branch to track                               |
| `--port, -p`        | auto         | Port number (auto-discovered if omitted)      |
| `--type, -t`        | auto-detect  | nextjs, nestjs, dotnet, static                |
| `--project-dir, -d` | —            | Subdirectory within repo (for monorepos)      |
| `--vcs`             | auto-detect  | git, svn, or local                            |

**Examples:**

```bash
# Basic initialization
dm init my-app --repo https://github.com/user/repo

# With specific branch and port
dm init my-app --repo git@github.com:user/repo.git --branch develop --port 3000

# Monorepo with subdirectory
dm init api-service --repo https://github.com/user/monorepo --project-dir packages/api

# Local folder
dm init local-app --repo /path/to/local/folder --vcs local

# Specify project type
dm init static-site --repo https://github.com/user/site --type static
```

### Deploy an Application

Build and deploy (or update) an application:

```bash
dm deploy <name> [--force] [--lint]
```

**The deploy pipeline:**

1. Acquires per-app file lock (prevents concurrent operations)
2. Pulls latest code (git/svn) or copies from local folder
3. Detects changes:
   - Git commit hash
   - Environment file hash
   - .NET appsettings hash
4. Exits early if no changes detected (unless `--force`)
5. Copies environment file into the release
6. Runs the build:
   - **Next.js/NestJS:** `npm install` + `npm run build`
   - **.NET:** `dotnet publish`
   - **Static:** No build (validates pre-built output)
7. Creates timestamped build snapshot (`builds/build-YYYYMMDD-HHmmss/`)
8. Symlinks attached storage volumes
9. Starts or restarts in PM2 with correct configuration
10. Records deployment metadata in database
11. Prunes old builds (keeps 3 most recent)
12. Releases lock

**Options:**

- `--force, -f`: Deploy even if no changes detected
- `--lint, -l`: Run linting during deployment

**Examples:**

```bash
# Standard deployment
dm deploy my-app

# Force deployment
dm deploy my-app --force

# Deploy with linting
dm deploy my-app --lint
```

### Control Application State

```bash
# Restart using active build
dm restart <name>

# Stop application
dm stop <name>

# Rollback to previous build
dm rollback <name> [--to <build-index>]

# Start all applications
dm start-all

# Stop all applications
dm stop-all
```

**Rollback examples:**

```bash
# Rollback to previous build
dm rollback my-app

# Rollback to specific build index (from Deploys tab)
dm rollback my-app --to 2
```

### Scale and Configure

Modify runtime configuration:

```bash
dm scale <name> [options]
```

**Options:**

| Option               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `--instances <n>`    | Number of PM2 cluster instances (1-N). Not supported for .NET.     |
| `--memory <size>`    | Max memory per instance (e.g. 250M, 1G, 512M). PM2 restarts on OOM. |
| `--autorestart`      | Enable/disable automatic restart on crash (true/false)              |
| `--max-restarts <n>` | Max unstable restarts before stopping (PM2 default: 15)             |
| `--min-uptime <t>`   | Min uptime before restart is unstable (e.g. 10s, 1m)               |
| `--restart-delay <ms>` | Delay between restarts in milliseconds (PM2 default: 0)          |
| `--kill-timeout <ms>`  | Grace period before SIGKILL (PM2 default: 1600)                  |
| `--node-args <args>` | Node.js arguments (e.g. --max-old-space-size=4096). Node.js only.  |
| `--show`             | Display current configuration without changes                       |
| `--reset-optional`   | Reset all optional parameters to PM2 defaults                       |

**Examples:**

```bash
# Scale to 4 instances with 512MB memory limit
dm scale my-app --instances 4 --memory 512M

# Disable auto-restart and limit retries
dm scale my-app --autorestart false --max-restarts 3

# Increase Node.js heap size
dm scale my-app --node-args "--max-old-space-size=4096"

# Show current configuration
dm scale my-app --show

# Reset to defaults
dm scale my-app --reset-optional
```

### Delete an Application

Permanently remove an application (CLI-only, requires SECRET_KEY):

```bash
dm delete <name> <secret>
```

**Example:**

```bash
dm delete my-app your-secret-key-from-env
```

---

## Environment Variables

Each application has a persistent environment directory that survives deployments. Changes to environment variables trigger a rebuild on the next deploy.

### Interactive Environment Editor

```bash
dm set-env <name>
```

Opens a full-screen TUI editor with:

**Keyboard shortcuts:**

- `↑↓` — Navigate rows
- `Enter` — Edit value inline
- `n` — Add new variable (prompts for key and value)
- `d` — Mark row for deletion
- `u` — Undo pending change
- `s` — Save changes (shows confirmation screen)
- `q` — Quit (prompts if unsaved changes)

**Visual indicators:**

- **Yellow** — Modified rows
- **Green** — New rows
- **Strikethrough** — Deleted rows

**After saving:** Run `dm deploy <name>` to apply changes.

### Environment File Locations

- **Next.js:** `<APP_DIR>/<name>/env/.env.local`
- **NestJS:** `<APP_DIR>/<name>/env/.env`
- **.NET:** `<APP_DIR>/<name>/env/appsettings.json` or `appsettings.Production.json`
- **Static:** No environment file

### How It Works

1. On deploy, dm computes hash of environment file
2. Compares with hash from previous deployment
3. If changed, copies file into new build and triggers rebuild
4. Even if code hasn't changed, environment changes force a new build

---

## Persistent Storage

Storage volumes are directories that survive deployments and are symlinked into each build.

### Storage Commands

```bash
# Create a storage volume
dm storage new <name> [link-name]

# Attach storage to an app
dm storage attach <app> <storage>

# Detach storage from an app (data preserved)
dm storage detach <app> <storage>

# Delete storage volume
dm storage rm <name>

# List all storage volumes
dm storage ls
```

**Parameters:**

- `<name>` — Storage directory name on disk
- `[link-name]` — Symlink name inside build directory (defaults to `<name>`)

**Examples:**

```bash
# Create storage with default link name
dm storage new uploads

# Create storage with custom link name
dm storage new media-files public/uploads

# Attach to application
dm storage attach my-app uploads

# List all storage
dm storage ls

# Detach from application
dm storage detach my-app uploads

# Delete storage (WARNING: deletes data)
dm storage rm uploads
```

### How It Works

1. Storage directory created at `<STORAGE_DIR>/<name>/`
2. On deploy, dm creates symlink `<build-dir>/<link-name>` → `<STORAGE_DIR>/<name>/`
3. Symlink is recreated in every new build
4. Data persists across deployments and rollbacks

---

## Nginx & Reverse Proxy

dm manages nginx configuration as code with SSL/TLS support, HTTP response headers, and WebSocket configuration.

### Domain Management

```bash
# Add a domain
dm domain add <name>

# Remove domain
dm domain remove <name> [--force]

# List all domains
dm domain list

# Show domain details
dm domain show <name>
```

**Examples:**

```bash
dm domain add example.com
dm domain add api.example.com
dm domain list
dm domain remove old-domain.com --force  # Removes all routes
```

### Route Management

Routes map a domain + path to an application:

```bash
# Add a route
dm route add <appName> <domainName> [--location <path>]

# Remove a route
dm route remove <domainName> [--location <path>]

# List routes for a domain
dm route list <domainName>
```

**Parameters:**

- `--location <path>` — URL path without leading slash (e.g. `api`, `admin/panel`)
- Omit `--location` for root `/`
- `--force` — Allow routing app that's already routed elsewhere

**Examples:**

```bash
# Route root path
dm route add my-app example.com

# Route subpath
dm route add api-service example.com --location api

# Route nested path
dm route add admin-panel example.com --location admin/dashboard

# List routes
dm route list example.com

# Remove route
dm route remove example.com --location api
```

### HTTP Response Headers

dm uses a three-layer merge system for HTTP response headers:

| Priority | Layer           | Source                                          |
| -------- | --------------- | ----------------------------------------------- |
| Lowest   | Built-in        | Security headers (X-Frame-Options, etc.)        |
| Middle   | Domain-level    | `dm domain set-header`                          |
| Highest  | Route-level     | `dm route set-header`                           |

**Built-in security headers:**

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (when SSL enabled)

**Header management:**

```bash
# Domain-level headers (interactive TUI editor)
dm domain set-header <name>

# Remove domain header
dm domain remove-header <name> --key <header-name>

# Route-level headers (interactive TUI editor)
dm route set-header <domainName> [--location <path>]

# Remove route header
dm route remove-header <domainName> [--location <path>] --key <header-name>
```

**Interactive header editor:**

- Same interface as environment editor
- Navigate, add, edit, delete headers
- Changes apply after running `dm domain push <name>`

**Examples:**

```bash
# Add custom headers to domain
dm domain set-header example.com

# Add custom headers to specific route
dm route set-header example.com --location api

# Remove specific header
dm domain remove-header example.com --key X-Custom-Header

# Push changes to nginx
dm domain push example.com
```

### SSL/TLS Certificates

dm supports PEM and PFX certificate formats with automatic validation:

```bash
# Set certificate (PEM format)
dm domain set-cert <name> --cert <cert.pem> --key <key.pem>

# Set certificate (PFX format)
dm domain set-cert <name> --pfx <bundle.pfx> --password <password>

# Check certificate status
dm domain cert-status <name>

# Remove certificate
dm domain remove-cert <name>

# Reload certificates from disk
dm domain reload-cert [name]
```

**Certificate validation:**

- Checks certificate is not expired
- Validates private key matches certificate public key
- Verifies certificate covers domain (exact match or wildcard `*.parent`)
- Use `--force` to skip domain coverage check

**Supported formats:**

- **PEM:** Separate certificate and private key files (any extension)
- **PFX/PKCS#12:** Bundle file with password (supports modern AES-256 and legacy RC2/3DES encryption)

**Security:**

- Private keys stored with chmod `0600`
- PFX passwords passed via temp file (not CLI args) to avoid process listing exposure
- Automatic fallback for legacy PFX encryption

**Storage location:** `<DOMAINS_DIR>/<domain>/ssl/`

**Examples:**

```bash
# PEM certificate
dm domain set-cert example.com --cert /path/to/cert.pem --key /path/to/key.pem

# PFX certificate
dm domain set-cert example.com --pfx /path/to/cert.pfx --password "secret"

# Force certificate that doesn't match domain
dm domain set-cert example.com --cert cert.pem --key key.pem --force

# Check status
dm domain cert-status example.com

# Reload certificates
dm domain reload-cert
```

### Nginx Configuration Management

```bash
# Preview config (does not write)
dm domain show-config <name>

# Compile and write config (does not reload nginx)
dm domain compile <name>

# Compile, write, validate, and reload nginx
dm domain push <name>
```

**Push process:**

1. Compiles nginx configuration
2. Snapshots current config and certificates
3. Writes new config to disk
4. Validates with `sudo nginx -t`
5. Reloads with `sudo nginx -s reload`
6. On failure: restores snapshot

**Generated configuration includes:**

- HTTP → HTTPS redirect (when SSL configured)
- HTTPS server block with TLS directives
- Location blocks for each route
- Proxy headers (`Host`, `X-Real-IP`, `X-Forwarded-*`)
- WebSocket headers (for Next.js routes)
- JSON access logging (`dm_json` format)
- WWW → apex redirect (if `www.<domain>` not registered)

**Access log format:**

dm creates `/etc/nginx/conf.d/dm_log_format.conf` with structured JSON logging:

```json
{
  "ts": "2024-01-15T10:30:45Z",
  "method": "GET",
  "uri": "/api/users",
  "status": 200,
  "bytes": 1024,
  "rt": 0.045,
  "addr": "192.168.1.100"
}
```

### Remote Nginx Push

dm can push configuration to a remote Linux machine via SSH:

```bash
# Set remote host in .env
NGINX_REMOTE_HOST=user@nginx-server.example.com
NGINX_REMOTE_KEY=/path/to/ssh/key
NGINX_SUDO_PASSWORD=sudo-password

# Push configuration
dm domain push example.com
```

**Remote push process:**

1. Compiles config locally
2. Rewrites certificate paths for remote system
3. Transfers config via SFTP to `/tmp/`
4. Moves config to `/etc/nginx/sites-available/` with sudo
5. Transfers certificates to target directory
6. Creates symlink in `/etc/nginx/sites-enabled/`
7. Writes log format snippet
8. Validates with `sudo nginx -t` over SSH
9. Reloads with `sudo nginx -s reload` over SSH
10. On failure: restores snapshot on remote

**Remote configuration:**

| Env Variable            | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `NGINX_REMOTE_HOST`     | `user@host` for remote nginx machine                |
| `NGINX_REMOTE_KEY`      | Path to SSH private key                             |
| `NGINX_REMOTE_PASSWORD` | SSH password (if no key)                            |
| `NGINX_SUDO_PASSWORD`   | sudo password (defaults to `NGINX_REMOTE_PASSWORD`) |
| `PUSH_CERT_DIR`         | Target cert directory on remote (default: `/etc/nginx/ssl`) |
| `PROXY_TARGET_HOST`     | Host to proxy to (default: `localhost`)             |

### Platform Requirements

- **Local push:** Linux only, requires nginx and sudo
- **Remote push:** dm runs on any OS, remote must be Linux with nginx and sudo
- **All other features:** Work on any OS

---

## TUI Dashboard

Full-screen terminal dashboard for real-time monitoring:

```bash
dm dashboard
# or alias:
dm monit
```

### Layout

- **Left column:** Application list with filters
- **Right column:** Detail pane with five tabs

### Polling Strategy

- **Fast poll (~2s):** App list, PM2 status, system resources
- **Detail poll (~5s):** Selected app only — port check, git drift, domains, logs, certificates

### Tabs

#### 1. Overview Tab

Displays:

- Port number and reachability status
- Project type and instance count
- Current branch and last commit
- PM2 uptime and restart count
- VCS drift status (color-coded):
  - **Green:** Up-to-date
  - **Yellow:** Behind/ahead
  - **Red:** Diverged
- SSL certificate status:
  - Issuer and expiry date
  - Days remaining (color-coded: green/yellow/red)
- All routes with full URLs and SSL indicators

#### 2. Metrics Tab

Toggle views with `v` key:

**Stats View:**

- CPU and memory sparklines + gauges
- Restart count with warnings
- Per-domain request metrics:
  - Total requests
  - Status class distribution (2xx/3xx/4xx/5xx)
  - p50/p95 latency

**Access Log View:**

- Recent nginx access logs from all routes
- Columns: timestamp, method, status (color-coded), response time, bytes
- Requires pushed nginx config with `dm_json` log format

Logs are read locally or via SSH (when `NGINX_REMOTE_HOST` set).

#### 3. Logs Tab

- Scrollable PM2 combined logs (stdout + stderr)
- stderr lines tagged with `[err]`
- Navigate with PgUp/PgDn

#### 4. Deploys Tab

- Full build history for selected app
- Active build highlighted
- Select and press `Enter` to rollback (with confirmation)

#### 5. Domains Tab

- All domains and routes for selected app
- SSL status color-coded:
  - **Green:** Valid
  - **Yellow:** Expiring within 30 days
  - **Red:** Expired/missing
- Staleness indicator when config changed but not pushed

### Keyboard Shortcuts

- `r` — Restart application (with confirmation)
- `s` — Stop application (with confirmation)
- `d` — Deploy application (with confirmation)
- `b` — Rollback (with confirmation)
- `e` — Open environment editor
- `l` — Jump to logs tab
- `f` — Filter app list
- `:` — Open command palette
- `q` — Quit dashboard

---

## Database Management

dm includes powerful PostgreSQL schema migration tools with visual diff and step-by-step migration plans.

### Database Connection Management

```bash
# Register a database connection
dm db register <name> --username <user>

# List all registered databases
dm db list

# Update connection details
dm db update <name> [options]

# Remove database connection
dm db remove <name>
```

**Register options:**

| Option              | Default     | Description                           |
| ------------------- | ----------- | ------------------------------------- |
| `--username, -u`    | required    | Database username                     |
| `--host, -h`        | localhost   | Database host                         |
| `--port, -p`        | 5432        | Database port                         |
| `--database, -d`    | <name>      | Database name                         |
| `--ssl-mode`        | require     | SSL mode: disable, require, verify-full |
| `--owner-role`      | —           | Optional owner role to SET ROLE after connecting |

**Examples:**

```bash
# Register production database
dm db register prod-db --username dbuser --host db.example.com --port 5432

# Register with SSL and owner role
dm db register secure-db --username dbuser --ssl-mode verify-full --owner-role app_owner

# Update database host
dm db update prod-db --host new-db.example.com

# Update password (prompts securely)
dm db update prod-db --password

# List all connections with status
dm db list

# Remove database connection
dm db remove old-db
```

### Schema Comparison

View differences between current schema and desired schema:

```bash
dm db compare <name>
```

**Interactive TUI shows:**

- Side-by-side comparison
- Added/removed/modified tables
- Added/removed/modified columns
- Index changes
- Foreign key changes
- Schema differences highlighted

**Example:**

```bash
dm db compare prod-db
```

### Database Migrations

Execute schema migrations with step-by-step plans:

```bash
dm db migrate <name> <key> [--type <type>]
```

**Migration types:**

- `generated` — Auto-generated from schema diff
- `manual` — Manually written SQL
- `data` — Data-only migration

**Interactive migration TUI:**

1. **Plan Review:** Shows all steps with hazard levels
2. **Step Execution:** Executes each step with progress
3. **Manual Review:** Pauses for approval on dangerous operations
4. **Rollback:** Automatic rollback on failure

**Hazard levels:**

- **Safe:** No data loss risk
- **Warning:** Potential issues, review recommended
- **Destructive:** Data loss possible, requires confirmation

**Examples:**

```bash
# Generate migration from schema comparison
dm db compare prod-db
# Review changes, then:
dm db migrate prod-db add-users-table --type generated

# Create manual migration
dm db migrate prod-db custom-migration --type manual

# Pipe SQL from file
cat migration.sql | dm db migrate prod-db from-file --type manual

# Data migration
dm db migrate prod-db seed-data --type data
```

### Migration History

View migration history and details:

```bash
# List all migrations
dm db history <name>

# View detailed step-by-step log
dm db history <name> <key>
```

**History includes:**

- Migration key and type
- Status (succeeded, failed, running)
- Performed by (user)
- Timestamp
- Step-by-step progress

**Examples:**

```bash
# List all migrations for database
dm db history prod-db

# View detailed migration log
dm db history prod-db add-users-table
```

### How It Works

1. **Connection:** dm connects to PostgreSQL using credentials from database registry
2. **Schema introspection:** Reads current schema from database
3. **Comparison:** Compares with desired schema (from code or manual input)
4. **Plan generation:** Creates step-by-step migration plan with hazard assessment
5. **Execution:** Runs each step in transaction (with manual approval for dangerous ops)
6. **Logging:** Records all steps and results in migration history
7. **Rollback:** Automatic rollback on failure

**Security:**

- Database passwords encrypted with `DB_CRED_KEY` (from .env)
- Connection details stored in dm's database
- Migration audit trail with timestamps and user info

---

## Remote Access (SSH Server)

dm includes a built-in SSH server for secure remote management. The server exposes only the dm REPL — no shell access, no SFTP, no port forwarding.

### Starting the Server

Start the SSH server as a background daemon:

```bash
dm remote start [--port 2022] [--daemon]
```

**Start modes:**

- `--daemon` — Runs as detached background process (recommended for production)
- Without `--daemon` — Runs in foreground with live log output

The server creates a PID file and can be managed with standard commands.

**Examples:**

```bash
# Start in background (recommended)
dm remote start --daemon

# Start on custom port
dm remote start --port 2200 --daemon

# Start in foreground (for debugging)
dm remote start
```

### Managing the Server

```bash
# Stop server
dm remote stop [--force]

# Restart server
dm remote restart [--port 2022] [--daemon]

# View server status (interactive TUI)
dm remote status

# View server health (quick check)
dm remote health [--quiet]

# Show configuration
dm remote info

# View logs
dm remote logs [--follow] [--lines 50]
```

**Examples:**

```bash
# View interactive status dashboard
dm remote status

# Check if server is running
dm remote health

# View live logs
dm remote logs --follow

# Stop server gracefully
dm remote stop

# Force stop
dm remote stop --force
```

### System Service Installation

Install as system service for auto-start on boot:

```bash
# Install service
dm remote install-service [--port 2022]

# Uninstall service
dm remote install-service --uninstall
```

**Platforms:**

- **Linux:** Creates systemd service
- **Windows:** Creates Windows Service

### SSH Key Management

Public key authentication only (no passwords):

```bash
# Add authorized key (interactive)
dm remote key-add

# Remove authorized key
dm remote key-remove <username>

# List all authorized keys
dm remote key-list

# Rename user
dm remote key-rename <old-username> <new-username>
```

**Legacy aliases:** `dm remote add`, `dm remote remove`, `dm remote list`

**Interactive key addition:**

1. Prompts for username
2. Prompts for public key (paste entire key)
3. Validates key type and format
4. Computes SHA256 fingerprint
5. Rejects duplicates (by fingerprint or username)
6. Saves to `.remote/authorized_keys`

**Accepted key types:**

| Type                          | Notes                              |
| ----------------------------- | ---------------------------------- |
| `ssh-ed25519`                 | Recommended (most secure)          |
| `sk-ssh-ed25519`              | FIDO2 hardware key (e.g. YubiKey)  |
| `ecdsa-sha2-nistp256/384/521` | ECDSA curves                       |
| `sk-ecdsa-sha2-nistp256`      | FIDO2 ECDSA                        |
| `ssh-rsa`                     | Accepted at **≥ 4096 bits only**   |

**Rejected:** RSA < 4096 bits, DSA keys

**Examples:**

```bash
# Add key interactively
dm remote key-add
# Enter username: john
# Paste public key: ssh-ed25519 AAAA...

# List keys
dm remote key-list

# Remove key
dm remote key-remove john

# Rename user
dm remote key-rename john john.doe
```

### Connecting to Remote Server

From a client machine:

```bash
dm remote connect <host> [--port 2022] [--identity ed25519]
```

**Key resolution order (strongest first):**

1. `id_ed25519`
2. `id_ed25519_sk`
3. `id_ecdsa`
4. `id_ecdsa_sk`
5. `id_rsa`

If no key found, offers to generate one via `ssh-keygen`.

**Supported identity types:** `ed25519`, `ed25519_sk`, `ecdsa`, `ecdsa_sk`, `rsa`

**SSH options used:**

- `StrictHostKeyChecking=ask` — Prompts for unknown hosts
- `BatchMode=no` — Allows interactive prompts
- `IdentitiesOnly=yes` — Only uses specified identity
- `ServerAliveInterval=30` — Keep-alive every 30s
- `ServerAliveCountMax=3` — Disconnect after 3 failed keep-alives

**Examples:**

```bash
# Connect with default settings
dm remote connect user@server.example.com

# Connect to custom port
dm remote connect user@server.example.com --port 2200

# Use specific key type
dm remote connect user@server.example.com --identity rsa
```

### Security Features

**Authentication:**

- Public key only (no password authentication)
- Client sends key for probing, server verifies before requesting signature
- Key-based user identification

**Brute-force Protection:**

- Failed attempts tracked per IP address
- Lockout duration: `2^attempts` seconds
- Capped at 10 minutes maximum
- Stored in `.remote/login_attempts.json`

**Audit Logging:**

Every event logged to `.remote/audit.log`:

- Connection attempts (success/failure)
- Authentication results
- All REPL commands executed
- Disconnections
- Timestamps, IP addresses, key fingerprints, usernames

**Command Restrictions:**

Inside remote sessions, these commands are blocked:

- `remote` — No nested remote management
- `update` — No self-updates
- `install-service` — No service installation
- `migrate-db` — No database migration

**Session Management:**

| Env Variable                  | Default | Description                       |
| ----------------------------- | ------- | --------------------------------- |
| `REMOTE_MAX_SESSIONS`         | 10      | Max concurrent sessions total     |
| `REMOTE_MAX_SESSIONS_PER_KEY` | 3       | Max sessions per authorized key   |
| `REMOTE_IDLE_TIMEOUT_MS`      | 1800000 | Idle timeout (30 minutes)         |
| `REMOTE_BIND`                 | 127.0.0.1 | Bind address (use 0.0.0.0 to expose) |
| `REMOTE_PORT`                 | 2022    | Default SSH port                  |

**Session Isolation:**

Each SSH session:

- Runs in separate Node.js process
- Has separate PM2 connection
- Has separate database connection
- Has real PTY (readline, colors, TUIs work normally)

**Graceful Shutdown:**

On SIGTERM:

1. Stops accepting new connections
2. Waits for active sessions to finish
3. Cleans up resources
4. Exits

### Remote Status Dashboard (TUI)

View real-time server status with an interactive dashboard:

```bash
dm remote status
```

The status dashboard displays:

**Top bar:**

- Bind address and port
- Truncated host key fingerprint
- Live clock

**Active sessions table:**

- Session ID
- Username
- IP address
- Session type (shell/exec)
- Uptime

**Actions:**

- `↑↓` — Select session
- `D` — Disconnect session (with confirmation)
- `Q` — Close dashboard (server keeps running)

**Event log:**

- Scrollable event history
- Connection/disconnection events
- Authentication results
- Navigate with PgUp/PgDn

**Note:** The server continues running in the background when you exit the status dashboard. Use `dm remote stop` to stop the server.

### Host Key Management

On first run:

1. Generates ed25519 host key
2. Saves to `.remote/host_ed25519_key` (mode `0600`)
3. Computes SHA256 fingerprint
4. Prints fingerprint on startup

**Share fingerprint with users for TOFU (Trust On First Use) verification.**

**Example fingerprint:**

```
Host key fingerprint: SHA256:abc123def456...
```

---

## dm-connect (Windows Client)

`dm-connect` is a standalone .NET executable for Windows/Linux/macOS that provides a rich client experience for connecting to dm remote servers without requiring Node.js.

### Features

- **Server Management**: Save multiple servers with friendly names
- **Interactive Selection**: Choose from saved servers with a visual menu
- **Last Connected Tracking**: Automatically defaults to your most recent server
- **Connection Retry**: Press Enter to retry on failure instead of exiting
- **Automatic Key Management**: Auto-detects or generates SSH keys
- **Remote Command Execution**: Execute commands directly without entering REPL

### Interactive Mode (Recommended)

Run without arguments for an interactive experience:

```bash
dm-connect
```

**You'll see:**

1. List of saved servers with friendly names
2. Last connected server highlighted in green with `◀ last` indicator
3. Options:
   - Press number to connect to that server
   - Press `N` to add a new server
   - Press `R` to remove a server
   - Press Enter to use default (last connected)

**Example:**

```
  Select a server to connect:

    [1] Production  (prod-server.example.com:2022)  ◀ last
    [2] Development  (192.168.1.10:2022)
    [3] Staging  (staging.example.com:2022)
    [N] + New Server
    [R] - Remove Server

  Choice [default: 1]:
```

### Command-Line Mode

Connect directly to a server:

```bash
# Connect to server
dm-connect <host> [options]

# Execute remote command without entering REPL
dm-connect <host> [options] <command...>
```

**Options:**

| Option              | Description                              |
| ------------------- | ---------------------------------------- |
| `--port, -p`        | Port (default: 2022)                     |
| `--identity, -i`    | Key type: ed25519, ed25519_sk, ecdsa, ecdsa_sk, rsa |
| `--help, -h`        | Show help                                |

**Examples:**

```bash
# Connect interactively
dm-connect 192.168.1.10

# Connect to custom port
dm-connect prod-server.example.com --port 2200

# Use specific key type
dm-connect 192.168.1.10 --identity ecdsa

# Execute single command
dm-connect 192.168.1.10 deploy my-app

# Execute command with arguments
dm-connect 192.168.1.10 -p 2022 logs my-app --follow
```

### Server Management

#### Adding a Server

1. Run `dm-connect` without arguments
2. Press `N` for "New Server"
3. Enter:
   - **Server name**: Friendly name (e.g., "Production", "Dev Server")
   - **Host**: IP address or hostname
   - **Port**: SSH port (default: 2022)

The server is saved for future sessions.

#### Removing a Server

1. Run `dm-connect` without arguments
2. Press `R` for "Remove Server"
3. Select server number to remove
4. Confirm with `yes` or `y`

#### Saved Server Location

Servers are stored in: `%TEMP%\dm-connect-servers.json` (Windows) or `/tmp/dm-connect-servers.json` (Linux/macOS)

### Connection Retry

When connection fails (timeout, auth error, unreachable server):

1. Error message displayed with possible causes
2. Your public key is shown
3. **Press Enter to retry** connection
4. Press any other key to exit

Perfect for waiting on server startup or authorization!

### First-Time Setup

1. Run `dm-connect` or `dm-connect <host>`
2. dm-connect probes `~/.ssh/` for supported key types
3. If no key found, offers to generate ed25519 key pair
4. Copy the displayed public key
5. Send public key to server admin
6. Admin authorizes key with `dm remote key-add` on server
7. Press Enter to retry connection — connected!

### Exit Codes

- `0` — Success
- `255` — Connection or authentication failure
- Other — SSH error codes

### Requirements

**To use dm-connect:**

- Windows OpenSSH Client (pre-installed on Windows 10+)
- Or OpenSSH on Linux/macOS (pre-installed)

**Windows OpenSSH installation:**

Via Settings:
```
Settings → Apps → Optional Features → OpenSSH Client
```

Via PowerShell (Admin):
```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

---

## Monitoring & Logs

### Application Logs

```bash
# Stream live logs (PM2 combined output)
dm logs <name>

# View nginx access logs (requires pushed domains)
dm metrics <name>

# Clear logs
dm log-clear <name>
dm log-clear --all
```

### Application Information

```bash
# Show detailed app metadata
dm info <name>

# List all applications
dm list

# Filter by type
dm list --type nextjs

# Show with storage columns
dm list --storages

# Show with routes columns
dm list --routes
```

### Log Types

**PM2 logs:**

- Combined stdout and stderr
- Located in PM2 log directory
- Cleared with `dm log-clear`

**Nginx logs:**

- JSON format access logs
- Per-route logging
- Viewed with `dm metrics` or dashboard Metrics tab
- Located in `/var/log/nginx/`

---

## Utilities

### Lock Management

```bash
# Force-release a stuck lock
dm unlock <name>
```

Kills the process holding the lock and removes the lock file.

### Cleanup

```bash
# Discard uncommitted local changes
dm clean <name>

# Clean all apps and prune old builds
dm clean-all
```

### Update dm

```bash
dm update
```

CLI-only. Updates dm itself to the latest version from GitHub.

### Change Repository

```bash
dm change-repo <name> --repo <url> [--branch <name>]
```

CLI-only. Updates the repository URL and/or branch for an application.

**Examples:**

```bash
# Change repository
dm change-repo my-app --repo https://github.com/user/new-repo

# Change branch
dm change-repo my-app --branch develop

# Change both
dm change-repo my-app --repo https://github.com/user/new-repo --branch main
```

### Install Boot Service

```bash
# Install service
dm install-service

# Uninstall service
dm install-service --uninstall
```

CLI-only. Installs a system service to run `dm start-all` on boot.

**Platforms:**

- **Linux:** Creates systemd service
- **Windows:** Creates Windows Service

### Database Migration

```bash
dm migrate-db
```

CLI-only. Performs tool database schema migrations and maintenance.

## Configuration Reference

All configuration is stored in `.env` file in the dm data directory.

### Directory Locations

| Variable          | Default                              | Description                      |
| ----------------- | ------------------------------------ | -------------------------------- |
| `DM_ROOT`         | See below                            | Override data directory location |
| `APP_DIR`         | `<DM_ROOT>/applications`             | Root for all managed apps        |
| `NEXT_DIR`        | `APP_DIR`                            | Override for Next.js apps        |
| `NEST_DIR`        | `APP_DIR`                            | Override for NestJS apps         |
| `DOTNET_DIR`      | `APP_DIR`                            | Override for .NET apps           |
| `STATIC_DIR`      | `APP_DIR`                            | Override for static apps         |
| `STORAGE_DIR`     | `<APP_DIR>/storages`                 | Root for storage volumes         |
| `DOMAINS_DIR`     | `<DM_ROOT>/domains`                  | Root for domain configs and SSL  |
| `LOCK_DIR`        | `<DM_ROOT>/locks`                    | Runtime lock files               |
| `REMOTE_DIR`      | `<DM_ROOT>/remote`                   | SSH server keys and logs         |

**Default `DM_ROOT` locations:**

- **Linux:** `/opt/deployment-manager/`
- **Windows:** `C:\ProgramData\deployment-manager\`
- **Override:** Set `DM_ROOT` environment variable

### Nginx Configuration

| Variable                | Default         | Description                                 |
| ----------------------- | --------------- | ------------------------------------------- |
| `NGINX_REMOTE_HOST`     | —               | `user@host` for remote nginx                |
| `NGINX_REMOTE_KEY`      | —               | SSH private key path                        |
| `NGINX_REMOTE_PASSWORD` | —               | SSH password (if no key)                    |
| `NGINX_SUDO_PASSWORD`   | —               | sudo password (defaults to SSH password)    |
| `PUSH_CERT_DIR`         | `/etc/nginx/ssl`| Target cert directory on remote             |
| `PROXY_TARGET_HOST`     | `localhost`     | Host to proxy to in nginx config            |

### Database Configuration

| Variable           | Default         | Description                                 |
| ------------------ | --------------- | ------------------------------------------- |
| `DATABASE_TYPE`    | `sqlite`        | Database type: `sqlite` or `postgres`       |
| `DATABASE_URL`     | —               | PostgreSQL connection string (for postgres) |
| `SECRET_KEY`       | —               | Secret key for app deletion confirmation    |
| `DB_CRED_KEY`      | `SECRET_KEY`    | Encryption key for database passwords       |

### Database Migration Tools

| Variable                | Default         | Description                                 |
| ----------------------- | --------------- | ------------------------------------------- |
| `DB_DEFAULT_HOST`       | `localhost`     | Default host for new database connections   |
| `DB_DEFAULT_PORT`       | `5432`          | Default port for new database connections   |
| `DB_COMPARE_USER`       | —               | User with CREATEDB for schema comparison    |
| `DB_COMPARE_PASSWORD`   | —               | Password for schema comparison user         |
| `PG_SCHEMA_DIFF_DIR`    | Auto-detected   | Path to pg-schema-diff tool                 |

### Remote SSH Server

| Variable                      | Default        | Description                          |
| ----------------------------- | -------------- | ------------------------------------ |
| `REMOTE_PORT`                 | `2022`         | SSH server port                      |
| `REMOTE_BIND`                 | `127.0.0.1`    | Bind address (0.0.0.0 to expose)     |
| `REMOTE_MAX_SESSIONS`         | `10`           | Max concurrent sessions              |
| `REMOTE_MAX_SESSIONS_PER_KEY` | `3`            | Max sessions per authorized key      |
| `REMOTE_IDLE_TIMEOUT_MS`      | `1800000`      | Idle timeout in milliseconds (30min) |

### Environment File Example

```bash
# dm Configuration

# Data directories
DM_ROOT=/opt/deployment-manager
APP_DIR=/opt/deployment-manager/applications
DOMAINS_DIR=/opt/deployment-manager/domains

# Nginx remote configuration
NGINX_REMOTE_HOST=user@nginx-server.example.com
NGINX_REMOTE_KEY=/home/user/.ssh/id_ed25519
NGINX_SUDO_PASSWORD=sudo-password
PUSH_CERT_DIR=/etc/nginx/ssl
PROXY_TARGET_HOST=app-server.local

# Database
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/dm

# Security
SECRET_KEY=your-secret-key-here
DB_CRED_KEY=your-encryption-key-here

# Database migration tools
DB_DEFAULT_HOST=localhost
DB_DEFAULT_PORT=5432
DB_COMPARE_USER=admin_user
DB_COMPARE_PASSWORD=admin_password

# Remote SSH server
REMOTE_PORT=2022
REMOTE_BIND=127.0.0.1
REMOTE_MAX_SESSIONS=10
REMOTE_MAX_SESSIONS_PER_KEY=3
REMOTE_IDLE_TIMEOUT_MS=1800000
```

---
