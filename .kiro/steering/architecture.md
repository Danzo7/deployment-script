---
inclusion: manual
---

# Deployment Manager — Architecture Overview for AI Assistants

This document describes the full internal architecture of the `dm` CLI tool so an AI assistant can understand how it works, reason about it, and suggest or implement improvements.

---

## What It Is

`dm` is a Node.js CLI tool (TypeScript, ESM) for managing the full lifecycle of self-hosted Next.js and NestJS applications on a single server. It wraps PM2 for process management and Git for source control, and maintains a local JSON database of registered apps.

The CLI binary is `dm`, entry point is `src/cli.ts`, built to `dist/` via `tsc`.

---

## Directory Structure

```
src/
  cli.ts               # Yargs-based CLI entry, command registration, lock middleware
  constants.ts         # APP_DIR, LOCK_DIR, ROOT_DIR (resolved from env or defaults)
  commands/            # One file per command, thin orchestration layer
  db/
    db.ts              # LowDB initialization (JSONFileSync, singleton)
    model.ts           # App interface
    repos.ts           # AppRepo — all CRUD operations on the DB
  utils/
    pm2-helper.ts      # PM2 connect/start/stop/delete/status wrappers
    git-helper.ts      # simple-git wrappers: clone, pull, push, reset
    npm-helper.ts      # execSync wrappers: npm install, npm run build/fix
    file-utils.ts      # Directory setup, build snapshot creation, file hashing
    env-heper.ts       # Env file diffing and injection
    lock-utils.ts      # File-based per-app locking using PIDs
    network-utils.ts   # portfinder wrapper for auto port assignment
    retry-helper.ts    # withRetry and withBackoffRetry generic helpers
    logger.ts          # Chalk-based logger (info, warn, error, success, highlight)
```

---

## Data Model

Stored in `<APP_DIR>/db.json` via LowDB (flat JSON, synchronous reads/writes).

```ts
interface App {
  id: string;
  name: string;           // unique, used as PM2 process name
  appDir: string;         // absolute path: <APP_DIR>/<name>
  repo: string;           // git remote URL
  branch: string;
  port: number;           // unique, used as NODE_ENV PORT
  instances: number;      // PM2 cluster instances
  projectType: 'nextjs' | 'nestjs';
  builds: string[];       // absolute paths to build snapshots
  activeBuild: number;    // index into builds[]
  lastDeploy: string;     // ISO date string
  createdAt: string;
  updatedAt: string;
}
```

`AppRepo` in `repos.ts` exposes: `getAll`, `findByName`, `add`, `remove`, `update`, `addBuild`, `removeBuild`.

---

## Per-App Directory Layout

Each app gets a directory at `<APP_DIR>/<name>/` with this structure:

```
<APP_DIR>/<name>/
  release/       # git working tree (clone target)
  env/           # managed env files (.env.local or .env)
  logs/          # pm2.out.log, pm2.error.log, prepare-*.log
  builds/
    build-<timestamp>/   # immutable build snapshot (see below)
```

---

## Build Snapshot System

After a successful build, the tool doesn't run the app from the `release/` directory. Instead it creates a timestamped snapshot in `builds/`:

**For Next.js:**
- Copies `.next/` folder from `release/`
- Symlinks `node_modules` from `release/` (avoids duplication)
- Copies `.env.local` from `env/`
- Copies `next.config.*` files
- Deletes `.next/` from `release/` after copy

**For NestJS:**
- Copies `dist/` folder
- Symlinks `node_modules`
- Copies `.env` / `.env.production` from `env/`
- Copies `package.json`
- Deletes `dist/` from `release/` after copy

PM2 is pointed at the snapshot directory, not `release/`. This means a redeploy creates a new snapshot, and old ones are cleaned up by `dm clean` while preserving the active build.

`activeBuild` in the DB is the index of the currently running snapshot. `dm start-all` uses `builds[activeBuild]` to restart apps after a server reboot.

---

## Deploy Flow (`dm deploy <name>`)

1. Look up app in DB — error if not found
2. `ensureDirectories` — create `release/`, `env/`, `logs/` if missing
3. `handleGitRepo` — clone if no repo exists, otherwise fetch + pull if behind. Returns `true` if new commits were pulled.
4. `getAppStatus` via PM2 — returns `online | stopped | errored | not-found | ...`
5. `checkEnv` — SHA256-hashes the env file in `env/` vs the one in `release/`. If different, copies `env/` version into `release/`. Returns `true` if changed.
6. Skip condition: if no git changes, no env changes, not first deploy, and app is running → exit early (unless `--force`)
7. `prepare(relDir, { withInstall, withBuild, withFix })` — runs `npm install`, optionally `npm run fix`, then `npm run build` via `execSync` with output piped to a log file
8. `createBuildDirByType` — creates the build snapshot
9. `runApp` — connects to PM2, deletes old process if exists, starts new one pointing at snapshot dir
10. `AppRepo.addBuild` — records snapshot path, updates `lastDeploy`, sets `activeBuild`
11. If `--lint` was passed, push lint changes back to remote

---

## Locking

Before any command that takes a `name` argument (except `unlock`), the CLI middleware calls `acquireLock(name)`, which writes a `.lock` file containing the current PID to `<LOCK_DIR>/<name>.lock`. On process exit (normal, SIGINT, or uncaughtException), `releaseLock` deletes it.

If a lock file already exists when `acquireLock` is called, it throws — preventing two concurrent `dm` commands from running on the same app.

`dm unlock <name>` calls `forceReleaseLock` which reads the PID from the lock file, sends SIGTERM to that process, and deletes the file.

---

## PM2 Integration

All PM2 operations go through `pm2-helper.ts` which wraps the PM2 programmatic API with Promises.

Apps always run in `cluster` mode with `max_memory_restart: "250M"`. Port is passed via `env.PORT`.

- **Next.js**: script = `node_modules/next/dist/bin/next`, args = `start -p <port>`
- **NestJS**: script = `dist/main.js` (absolute path inside snapshot dir)

PM2 process name = app name in the DB. Status is fetched by listing all PM2 processes and finding by name.

---

## Environment Variable Management

Env files are stored in `<APP_DIR>/<name>/env/` (outside the git working tree). This keeps them safe across `clean` and git operations.

`dm set-env <name> VAR=VALUE` writes directly to that `env/` file using regex replace-or-append logic.

On every deploy, `checkEnv` compares the `env/` file to whatever is in `release/` and syncs it if different. This ensures the correct env is always baked into the build.

---

## IIS Config Generation

`dm iis-config` writes a `web.config` to `<APP_DIR>/<name>/web.config`. It's a reverse proxy config that rewrites all requests to `http://localhost:<port>`. Optional flags add HTTPS redirect and non-www redirect rules.

---

## Gitea Workflow Generation

`dm workflow <name>` creates `.gitea/workflows/deploy.yaml` inside the `release/` dir and pushes it to the remote. The workflow runs `dm deploy <name>` on every push, using a self-hosted Gitea Actions runner on Windows.

Only works for non-GitHub repos (self-hosted Gitea assumed).

---

## Retry Logic

`withRetry(name, fn, retries=3, delay=1000ms)` — fixed delay between attempts.
`withBackoffRetry(name, fn, retries=5, baseDelay=2000ms)` — delay multiplies by attempt number.

Used throughout `git-helper.ts` for all git operations.

---

## Key Constraints and Assumptions

- Runs on Windows (IIS integration, Gitea runner configured as `runs-on: windows`)
- Single-server deployment model — all apps run on the same machine as the CLI
- PM2 must be available globally or as a project dependency
- App names must be unique — they double as PM2 process identifiers
- Port range for auto-assignment: 50000–50999
- `SECRET_KEY` env var is required for `dm delete`
- `APP_DIR` and `LOCK_DIR` are resolved from `.env` at `ROOT_DIR` if set, otherwise default to `.applications/` and `.locks/` relative to the project root

---

## Extension Points

When adding new features, follow these patterns:

- **New command**: add a file in `src/commands/`, register it in `src/cli.ts` with `.command()`
- **New project type**: extend the `projectType` union in `model.ts`, add a case to `createBuildDirByType` in `file-utils.ts` and `getPM2Config` in `pm2-helper.ts`
- **New DB fields**: add to the `App` interface in `model.ts` and update `AppRepo` methods as needed
- **New utility**: add to `src/utils/`, keep each file focused on a single concern
