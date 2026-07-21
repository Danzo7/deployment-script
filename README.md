# dm — Deployment Manager

A CLI + interactive shell for deploying and managing Next.js, NestJS, .NET, and static applications on a server using PM2. Includes an nginx reverse-proxy management layer, a full-featured TUI dashboard, and a built-in SSH remote access server.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Project types](#project-types)
- [Interactive shell (REPL)](#interactive-shell-repl)
- [App lifecycle](#app-lifecycle)
- [Environment variables (app env)](#environment-variables-app-env)
- [Persistent storage](#persistent-storage)
- [Nginx & reverse proxy](#nginx--reverse-proxy)
- [TUI Dashboard](#tui-dashboard)
- [Remote access (dm remote)](#remote-access-dm-remote)
- [dm-connect (Windows client)](#dm-connect-windows-client)
- [Monitoring & logs](#monitoring--logs)
- [Utilities](#utilities)
- [Configuration reference](#configuration-reference)
- [Database](#database)

---

## Requirements

| Concern               | Requirement                                        |
| --------------------- | -------------------------------------------------- |
| Runtime (server)      | Node.js 18+                                        |
| Process manager       | PM2 (global)                                       |
| Version control       | git, svn, or a local folder path                   |
| Nginx (reverse proxy) | Linux machine with nginx installed and sudo access |
| .NET apps             | .NET 8 SDK on the build machine                    |
| Remote SSH client     | OpenSSH client (`ssh` on PATH)                     |
| PFX cert extraction   | `openssl` on PATH                                  |

Nginx operations require Linux. dm can be installed on any OS for app management (deploy, env, logs, etc.), but `domain push` only succeeds when nginx is reachable — either locally on Linux, or via a remote Linux host over SSH.

---

## Installation

```bash
npm install -g deployment-manager
```

Copy `.env.example` to `.env` in the dm root and edit as needed before use.

---

## Project types

| Type     | Build tool     | PM2 mode | Entry point                        |
| -------- | -------------- | -------- | ---------------------------------- |
| `nextjs` | npm run build  | cluster  | next start                         |
| `nestjs` | npm run build  | cluster  | dist/main.js                       |
| `dotnet` | dotnet publish | fork     | dotnet \<app\>.dll                 |
| `static` | none           | fork     | sirv (built-in static file server) |

Static apps must have pre-built files committed to the repo. A `package.json` with a build step is not supported for the static type.

---

## Interactive shell (REPL)

Running `dm` with no arguments starts an interactive shell with tab-completion, command history, and inline help.

```
$ dm
dm> help
dm> deploy my-app
dm> set-env my-app
dm> logs my-app
```

All commands are available in both the CLI (`dm <command>`) and the REPL, except commands marked `cliOnly` (delete, migrate-db, change-repo, install-service, update).

Inside a remote SSH session the env var `DM_REMOTE_USER` is set, and these additional commands are blocked: `remote`, `update`, `install-service`, `migrate-db`. Every command typed in a remote session is written to the audit log.

When a TUI takes over the terminal (dashboard, set-env editor, header editor), the REPL suspends its readline interface, waits for the TUI to exit, then resumes cleanly.

---

## App lifecycle

### init

```bash
dm init <name> --repo <url> [options]
```

Registers a new application and records it in the database. Does not deploy — run `dm deploy <name>` afterwards.

| Option              | Default  | Description                                   |
| ------------------- | -------- | --------------------------------------------- |
| `--repo, -r`        | required | Repository URL (git/svn) or local folder path |
| `--branch, -b`      | main     | Branch to track                               |
| `--instances, -i`   | 1        | PM2 cluster instances                         |
| `--port, -p`        | auto     | Port; auto-discovered if omitted              |
| `--type, -t`        | nextjs   | nextjs, nestjs, dotnet, static                |
| `--project-dir, -d` | —        | Subdirectory within repo (monorepo)           |
| `--vcs`             | git      | git, svn, or local                            |

### deploy

```bash
dm deploy <name> [--force] [--lint]
```

The deploy pipeline runs these steps in order:

1. Acquires a per-app file lock (blocks concurrent operations on the same app)
2. Pulls latest code via git/svn or copies from local folder
3. Detects whether anything changed — git commit hash, env file hash, .NET appsettings hash. If nothing changed and the app is running, exits early unless `--force` is set
4. Copies env file from the app's persistent env directory into the release
5. Runs the build: `npm install` + `npm run build` (Next.js/NestJS), `dotnet publish` (.NET), nothing (static)
6. Creates a timestamped build snapshot directory (`builds/build-YYYYMMDD-HHmmss/`) and symlinks any attached storage volumes into it
7. Starts or restarts the app in PM2 with the correct entry point, PORT env var, and exec mode
8. Records the deployment metadata (commit hash, build path, timestamp) in the database
9. Prunes all but the 3 most recent builds in the background
10. Releases the lock

### restart / stop / rollback

```bash
dm restart <name>
dm stop <name>
dm rollback <name> [--to <build-index>]
```

`rollback` re-points PM2 at a previous build directory without rebuilding. Use `--to <n>` to target a specific build index (visible in the Deploys tab). Defaults to the previous build.

### start-all / stop-all

```bash
dm start-all
dm stop-all
```

Iterates all registered applications and starts or stops each one.

### delete

```bash
dm delete <name> <secret>
```

CLI-only. Permanently removes an app and its files. Requires the `SECRET_KEY` value from your `.env` as confirmation.

---

## Environment variables (app env)

Each app has a persistent env directory that survives across deployments. On every deploy, dm compares the hash of the env file against the one copied into the last build. If they differ, the env file is written into the new build and a rebuild is triggered even if no code changed.

```bash
dm set-env <name>
```

Opens a full-screen interactive TUI editor:

- `↑↓` to navigate rows
- `enter` to edit a value inline
- `n` to add a new variable (prompts for key, then value)
- `d` to mark a row deleted
- `u` to undo a pending change
- `s` to review and save
- `q` to quit (asks for confirmation if there are unsaved changes)

Modified rows are highlighted yellow, new rows green, deleted rows strikethrough. After saving, dm reminds you to run `dm deploy <name>` to apply changes.

The env file is stored at `<APP_DIR>/<name>/env/.env.local` (Next.js) or `.env` (NestJS/.NET).

---

## Persistent storage

Storage volumes are directories that survive deployments. On each deploy, dm symlinks them into the new build directory.

```bash
dm storage new <name> [link-name]   # create a storage volume
dm storage attach <app> <storage>   # link storage to an app
dm storage detach <app> <storage>   # unlink (data is kept)
dm storage rm <name>                # delete the storage directory
dm storage ls                       # list all storages
```

`link-name` is the symlink name inside the build directory. Defaults to `name`.

---

## Nginx & reverse proxy

dm manages nginx configuration as code. You define domains and routes, dm compiles the nginx config, and you push it to nginx (local or remote). All header configuration, SSL, and routing is stored in the database.

### Domains

```bash
dm domain add <name>           # register a domain (e.g. example.com)
dm domain remove <name>        # remove domain (--force cascades to all routes)
dm domain list
dm domain show <name>
```

### Routes

A route maps a domain + path to an application.

```bash
dm route add <appName> <domainName> [--location <path>]
dm route remove <domainName> [--location <path>]
dm route list <domainName>
```

`--location` is the URL path without a leading slash (e.g. `api`, `admin/panel`). Omit for root `/`. Use `--force` to route an app that is already routed elsewhere.

### HTTP response headers

dm uses a three-layer merge for `add_header` directives in every location block:

| Layer | Source                                                                                                                                                            | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | Built-in defaults: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (+ HSTS when SSL enabled) | lowest   |
| 2     | Domain-level headers — `dm domain set-header`                                                                                                                     | middle   |
| 3     | Route-level headers — `dm route set-header`                                                                                                                       | highest  |

Route headers override domain headers which override the defaults. Collision resolution is case-insensitive (per HTTP spec); the winning layer's original key casing is preserved.

The proxy headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`) are always emitted as `proxy_set_header` directives and are not user-modifiable.

```bash
dm domain set-header <name>                              # interactive TUI editor
dm domain remove-header <name> --key <header>

dm route set-header <domainName> [--location <path>]     # interactive TUI editor
dm route remove-header <domainName> [--location <path>] --key <header>
```

`set-header` opens the same interactive TUI editor as `set-env`: navigate with arrow keys, edit with enter, add with `n`, delete with `d`, undo with `u`, save with `s`. After editing, run `dm domain push <name>` to apply.

### SSL certificates

```bash
dm domain set-cert <name> --cert <cert.pem> --key <key.pem>
dm domain set-cert <name> --pfx <bundle.pfx> --password <pass>
dm domain cert-status <name>
dm domain remove-cert <name>
dm domain reload-cert [name]
```

Two certificate formats are accepted:

**PEM:** provide `--cert` and `--key` as paths (any file extension).

**PFX/PKCS#12:** provide `--pfx` and `--password`. dm extracts the certificate and key by shelling out to the system `openssl` binary. The PFX password is written to a temp file (never passed as a CLI argument) to avoid exposure in process listings. Both modern (AES-256) and legacy-encrypted (RC2/3DES) PFX bundles are supported via automatic provider fallback.

On upload, dm validates:

- Certificate is not expired
- Private key matches the certificate public key
- Certificate covers the domain (exact DNS SAN or single-level wildcard `*.parent`)

Use `--force` to skip the domain coverage check.

Certs are stored under `<DOMAINS_DIR>/<domain>/ssl/` with the private key chmod `0600`. `reload-cert` synchronizes certificate metadata in the database from disk without deleting any files.

### Pushing config to nginx

```bash
dm domain compile <name>       # compile config to disk, no push
dm domain show-config <name>   # preview compiled config without writing
dm domain push <name>          # compile, write, validate, reload nginx
```

The compiled config includes:

- HTTP → HTTPS redirect when SSL is configured
- HTTPS server block with TLS directives
- One `location` block per registered route with `proxy_pass` to `localhost:<port>` (or `PROXY_TARGET_HOST:<port>`)
- Structured JSON access logging (`dm_json` log format) per route
- WebSocket headers for Next.js routes
- `www` → apex redirect block if `www.<domain>` is not separately registered

The push is atomic: dm snapshots the current nginx config and certs before writing anything. If `sudo nginx -t` or `sudo nginx -s reload` fails, the snapshot is restored.

The `dm_json` log format snippet is written once to `/etc/nginx/conf.d/dm_log_format.conf` and reused by all domain configs. It produces JSON access logs with: `ts`, `method`, `uri`, `status`, `bytes`, `rt` (response time ms), `addr`.

### Remote nginx push

If `NGINX_REMOTE_HOST` is set, `dm domain push` connects to a remote Linux machine via SSH and performs all operations there instead of locally:

1. Compiles config and rewrites cert paths to the target directory on the remote (default `/etc/nginx/ssl` or `PUSH_CERT_DIR`)
2. Transfers config via SFTP to `/tmp/`, then `sudo mv` to `/etc/nginx/sites-available/`
3. Transfers cert + key via SFTP, then `sudo mv` to target cert dir
4. Creates symlink in `/etc/nginx/sites-enabled/`
5. Writes the `dm_json` log format snippet
6. Runs `sudo nginx -t` and `sudo nginx -s reload` over SSH
7. On failure: restores the pre-operation snapshot on the remote machine

| Env var                 | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `NGINX_REMOTE_HOST`     | `user@host` for the remote nginx machine. If not set, pushes locally.     |
| `NGINX_REMOTE_KEY`      | Path to SSH private key for the remote connection                         |
| `NGINX_REMOTE_PASSWORD` | SSH password (only if `NGINX_REMOTE_KEY` is not set)                      |
| `NGINX_SUDO_PASSWORD`   | sudo password on the remote machine (defaults to `NGINX_REMOTE_PASSWORD`) |
| `PUSH_CERT_DIR`         | Target cert directory on the nginx machine                                |
| `PROXY_TARGET_HOST`     | Host to proxy to in nginx config (default: `localhost`)                   |

### Linux-only constraint

- **Local push:** Linux only. Requires nginx installed locally with sudo access.
- **Remote push:** dm can run on any OS. The remote machine must be Linux with nginx and sudo access.

All other dm features work on any OS.

---

## TUI Dashboard

```bash
dm dashboard
# alias:
dm monit
```

A full-screen terminal dashboard with a two-column layout: app list on the left, detail pane with five tabs on the right.

The dashboard uses two polling layers:

- **Fast poll (~2s):** app list, PM2 status for all apps, OS load average and memory
- **Detail poll (~5s, selected app only):** port reachability, git drift, domain info, nginx access logs, cert validity

### Overview tab

- Port, project type, instances, branch, last commit info
- PM2 uptime and restart count
- VCS drift (up-to-date / behind / ahead / diverged) color-coded
- SSL cert status — issuer, expiry date, days remaining (green/yellow/red)
- Port reachability check (attempts a TCP connection to the app's port)
- All configured routes with full URLs and SSL status

### Metrics tab

Toggle between two views with `v`:

**Stats view:**

- CPU and memory sparklines + gauges
- Restart count warnings
- Per-domain request metrics: total requests, status class distribution (2xx/3xx/4xx/5xx), p50/p95 latency

**Access log view:**

- Recent nginx access log entries from all routes on the selected app
- Columns: timestamp, method, status (color-coded by class), response time, bytes sent
- Falls back gracefully when the domain has not been pushed or the `dm_json` log format is not installed

Nginx logs are read from `/var/log/nginx/` locally, or via SSH/SFTP when `NGINX_REMOTE_HOST` is set.

### Logs tab

Scrollable tail of PM2 combined logs (stdout + stderr). stderr lines are tagged with `[err]`. Use PgUp/PgDn to scroll.

### Deploys tab

Full build history for the selected app. The active build is highlighted. Select a previous build and press `enter` to trigger a rollback (with confirmation dialog).

### Domains tab

All domains and routes for the selected app. SSL status is color-coded: green (valid), yellow (expiring within 30 days), red (expired/missing). A staleness indicator is shown when the config has been recompiled but not yet pushed to nginx.

**Keyboard actions:**

- `r` restart, `s` stop, `d` deploy, `b` rollback — all with confirmation dialogs
- `e` open interactive env editor for the selected app
- `l` jump to the logs tab
- `f` filter the app list
- `:` open command palette

---

## Remote access (dm remote)

dm includes a built-in SSH server that exposes the dm REPL — and nothing else — over the network. No shell access, no SFTP, no port forwarding.

### Starting the server

```bash
dm remote serve [--port 2022]
```

Starts the SSH server as a PM2 process named `dm-remote`. Default port is `2022` (override with `--port` or `REMOTE_PORT` env var).

The server binds to `127.0.0.1` by default. Set `REMOTE_BIND` to expose it on another interface (a warning is printed).

Each session spawns a real PTY via node-pty — readline, chalk, Ink TUIs, tab-completion, and Ctrl+C all behave exactly as they do locally. Sessions are completely isolated: separate Node.js processes, separate PM2 connections, separate database connections.

On first run, an ed25519 host key is generated and saved to `.remote/host_ed25519_key` (mode `0600`). The host key fingerprint (`SHA256:...`) is printed on startup. Share it with users out-of-band for TOFU verification.

Session limits:

| Env var                       | Default | Description                                |
| ----------------------------- | ------- | ------------------------------------------ |
| `REMOTE_MAX_SESSIONS`         | 10      | Max concurrent sessions total              |
| `REMOTE_MAX_SESSIONS_PER_KEY` | 3       | Max concurrent sessions per authorized key |
| `REMOTE_IDLE_TIMEOUT_MS`      | 1800000 | Idle session auto-terminate (ms)           |

### Key management

Public key authentication only — no passwords accepted.

```bash
dm remote add                # interactive: enter username, then paste public key
dm remote remove <username>  # remove key by username
dm remote list               # list authorized keys with fingerprints
```

Keys are stored in OpenSSH `authorized_keys` format at `.remote/authorized_keys`.

Accepted key types:

| Type                          | Notes                             |
| ----------------------------- | --------------------------------- |
| `ssh-ed25519`                 | Recommended                       |
| `sk-ssh-ed25519`              | FIDO2 hardware key (e.g. YubiKey) |
| `ecdsa-sha2-nistp256/384/521` | ECDSA                             |
| `sk-ecdsa-sha2-nistp256`      | FIDO2 ECDSA                       |
| `ssh-rsa`                     | Accepted at **≥ 4096 bits only**  |

RSA < 4096 bits and DSA keys are rejected. `remote add` validates the key type, computes a SHA256 fingerprint, and rejects duplicates by both fingerprint and username.

These commands are blocked inside a remote session.

### Connecting from a client

```bash
dm remote connect <host> [--port 2022] [--identity ed25519]
```

Shells out to the system `ssh` binary. Key resolution order (strongest first): `id_ed25519` → `id_ed25519_sk` → `id_ecdsa` → `id_ecdsa_sk` → `id_rsa` in `~/.ssh/`. If no key is found, dm offers to generate one via `ssh-keygen` and prints the public key to be authorized on the server.

Effective ssh invocation:

```
ssh -p <port> -i <keyPath>
    -o StrictHostKeyChecking=ask
    -o BatchMode=no
    -o IdentitiesOnly=yes
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
    dm@<host>
```

### Security model

- **Authentication:** public key only. Client sends key for probing first; server verifies it's in `authorized_keys` before requesting the signature.
- **Brute-force protection:** failed attempts tracked per IP. Lockout = `2^fails` seconds, capped at 10 minutes.
- **Audit log:** every connection event, auth result, and REPL command is appended to `.remote/audit.log` with timestamp, IP, key fingerprint, and username.
- **Command blocking:** `remote`, `update`, `install-service`, `migrate-db` cannot be run from within a remote session.
- **Session cap:** connections above `REMOTE_MAX_SESSIONS` are rejected immediately.
- **Idle timeout:** inactive sessions are terminated after `REMOTE_IDLE_TIMEOUT_MS`.
- **Graceful drain:** on SIGTERM, the server stops accepting new connections and waits for active sessions to finish.

### Remote serve dashboard

While the server is running, a TUI is shown:

- Top bar: bind address, port, truncated host key fingerprint, live clock
- Active sessions table: ID, username, IP, session type (shell/exec), uptime
- Select a session with `↑↓` and press `D` to disconnect (confirmation required)
- Scrollable event log at the bottom (PgUp/PgDn)
- `Q` to stop the server

---

## dm-connect (Windows client)

`dm-connect` is a standalone .NET 8 executable for Windows. It connects to a `dm remote serve` server without requiring a Node.js installation on the client.

```
dm-connect <host> [--port 2022] [--identity ed25519]
```

It provides colored console output and mirrors the exact key resolution and SSH connection logic of the TypeScript `dm remote connect` command:

1. Probes `~/.ssh/` for a private key in the same order as the TypeScript client
2. If no key is found, prompts to generate ed25519 via `ssh-keygen` and displays the public key
3. Shells out to `ssh.exe` with identical arguments (`StrictHostKeyChecking=ask`, `IdentitiesOnly=yes`, `ServerAliveInterval=30`, `ServerAliveCountMax=3`)
4. Returns `ssh.exe`'s exit code (255 = connection or auth failure)

Supported `--identity` values: `ed25519` (default), `ed25519_sk`, `ecdsa`, `ecdsa_sk`, `rsa`.

The algorithm list is kept in sync between dm-connect, the TypeScript client, and the server.

Windows OpenSSH client is required. Install it via:

```
Settings → Apps → Optional Features → OpenSSH Client
# or PowerShell (Admin):
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

---

## Monitoring & logs

```bash
dm logs <name>          # stream live PM2 logs (Ctrl+C to stop)
dm log-clear [name]     # clear log files for one app, or --all for all
dm info <name>          # show app metadata from the database
dm list [--type <t>]    # list all apps with PM2 status
```

---

## Utilities

```bash
dm unlock <name>                        # force-release a stuck lock
dm clean <name>                         # discard uncommitted local changes
dm clean-all                            # clean all apps and prune old builds
dm update                               # update dm itself  (CLI only)
dm change-repo <name> --repo <url> [--branch <name>]  # change the repo URL and/or branch for an app  (CLI only)
dm install-service                      # install a boot service to run dm start-all  (CLI only)
dm migrate-db                           # migrate from legacy db.json to SQL  (CLI only)
```

---

## Configuration reference

All settings are read from `.env` in the dm installation root.

| Variable                      | Default             | Description                                |
| ----------------------------- | ------------------- | ------------------------------------------ |
| `APP_DIR`                     | `.applications/`    | Root directory for all managed apps        |
| `NEXT_DIR`                    | `APP_DIR`           | Override root for Next.js apps             |
| `NEST_DIR`                    | `APP_DIR`           | Override root for NestJS apps              |
| `DOTNET_DIR`                  | `APP_DIR`           | Override root for .NET apps                |
| `STATIC_DIR`                  | `APP_DIR`           | Override root for static apps              |
| `STORAGE_DIR`                 | `APP_DIR/storages/` | Root for storage volumes                   |
| `DOMAINS_DIR`                 | `.domains/`         | Root for domain configs and certs          |
| `DATABASE_TYPE`               | `sqlite`            | `sqlite` or `postgres`                     |
| `DATABASE_URL`                | —                   | PostgreSQL connection string               |
| `SECRET_KEY`                  | —                   | Confirmation token required by `dm delete` |
| `PROXY_TARGET_HOST`           | `localhost`         | Proxy target host in nginx config          |
| `NGINX_REMOTE_HOST`           | —                   | `user@host` for remote nginx push          |
| `NGINX_REMOTE_KEY`            | —                   | SSH key path for remote nginx push         |
| `NGINX_REMOTE_PASSWORD`       | —                   | SSH password for remote nginx push         |
| `NGINX_SUDO_PASSWORD`         | —                   | sudo password on the remote nginx machine  |
| `PUSH_CERT_DIR`               | —                   | Target cert directory on the nginx machine |
| `REMOTE_PORT`                 | `2022`              | SSH server port for `dm remote serve`      |
| `REMOTE_BIND`                 | `127.0.0.1`         | Interface for the SSH server to bind on    |
| `REMOTE_MAX_SESSIONS`         | `10`                | Max concurrent SSH sessions                |
| `REMOTE_MAX_SESSIONS_PER_KEY` | `3`                 | Max sessions per authorized key            |
| `REMOTE_IDLE_TIMEOUT_MS`      | `1800000`           | Idle session timeout in milliseconds       |

---

## Database

dm v2.0 uses SQLite by default (better-sqlite3 + Drizzle ORM). PostgreSQL is supported by setting `DATABASE_TYPE=postgres` and `DATABASE_URL`.

The database stores: apps, build history, storage volumes, domains, routes, SSL certificate metadata.

Upgrading from v1.x: run `dm migrate-db` once to import from the legacy `db.json` format.
