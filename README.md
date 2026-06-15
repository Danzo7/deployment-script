# Deployment Manager CLI

A CLI tool for managing the full lifecycle of Next.js and NestJS applications — from initialization and deployment to process management and environment config. Built on top of PM2 and Git.

---

## Installation

```bash
git clone <repository-url>
cd <project-directory>
npm install
npm run build
npm link
```

---

## Commands

### `dm init <name>`

Register a new application.

```bash
dm init <name> --repo <repo-url> [options]
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--repo` | `-r` | required | Git repository URL |
| `--branch` | `-b` | `main` | Branch to deploy from |
| `--instances` | `-i` | `1` | Number of PM2 instances |
| `--port` | `-p` | auto | Port number (auto-assigned if omitted) |
| `--type` | `-t` | `nextjs` | App type: `nextjs` or `nestjs` |

---

### `dm deploy <name>`

Pull latest changes, install dependencies, build, and start/restart the app via PM2.

```bash
dm deploy <name> [--force] [--lint]
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--force` | `-f` | `false` | Force redeploy even if nothing changed |
| `--lint` | `-l` | `false` | Run linting and push fixes before deploying |

---

### `dm list`

Display all registered apps with their port, status, last deploy time, and directory.

```bash
dm list
```

---

### `dm start-all`

Start all registered applications that are not currently running, using their last known build.

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

### `dm set-env <name> <VAR=VALUE>`

Set or update an environment variable for an application.

```bash
dm set-env <name> API_URL=https://example.com
```

---

### `dm clean <name>`

Discard local git changes and remove old builds, keeping only the active one.

```bash
dm clean <name>
```

---

### `dm delete <name> <secret>`

Fully remove an application — stops the PM2 process, deletes the app directory, and removes it from the database. Requires a secret key (`SECRET_KEY` env var).

```bash
dm delete <name> <secret>
```

---

### `dm unlock <name>`

Force-release a stuck lock on an application by killing the associated process.

```bash
dm unlock <name>
```

---

### `dm update`

Pull the latest version of the `dm` tool itself, reinstall dependencies if needed, and rebuild.

```bash
dm update
```

---

## How It Works

- Apps are tracked in a local database (lowdb) with metadata like port, repo, branch, build history, and last deploy time.
- Each command acquires a per-app lock to prevent concurrent operations on the same app.
- Deployment checks for git changes and env changes before deciding whether to rebuild, so unchanged apps are skipped unless `--force` is used.
- PM2 is used for process management — apps run in cluster mode with a 250MB memory restart threshold.
- Builds are versioned and stored; `clean` prunes old ones while preserving the active build.
