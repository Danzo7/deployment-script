# Deployment Manager CLI

A CLI tool for managing the full lifecycle of Next.js, NestJS, and .NET Core API applications — from initialization and deployment to process management and environment config. Built on top of PM2 and Git.

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
| `--type` | `-t` | `nextjs` | App type: `nextjs`, `nestjs`, or `dotnet` |
| `--project-dir` | `-d` | none | Subdirectory within the repo that contains the project (for monorepos) |

#### Monorepo support

If your repository contains multiple apps (e.g. a shared `Common/` library alongside `PublicApi/` and `AdminApi/` projects), use `--project-dir` to point `dm` at the specific subfolder to build and deploy.

```bash
# Register the public API from a monorepo
dm init public-api --repo https://github.com/org/monorepo --type dotnet --project-dir PublicApi

# Register the admin API from the same repo
dm init admin-api --repo https://github.com/org/monorepo --type dotnet --project-dir AdminApi
```

This works for all project types — `nextjs`, `nestjs`, and `dotnet`. The git clone always targets the repo root; `--project-dir` only affects where the build runs and where build artifacts are looked for.

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

Set or update an environment variable for an application. For .NET apps the variable is written to `.env` in the app's `env/` directory.

```bash
dm set-env <name> API_URL=https://example.com
```

> **dotnet apps — appsettings files:** `dm set-env` manages key/value pairs in `.env`. For `appsettings.json` and `appsettings.Production.json`, place the files directly in the app's `env/` directory on the server (`<APP_DIR>/<name>/env/`). They will be injected into the release directory automatically on the next `dm deploy`.

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

### `dm rollback <name>`

Roll back an application to a previous build.

```bash
dm rollback <name> [--to <index>]
```

| Option | Description |
|---|---|
| `--to` | Build index to roll back to. If omitted, lists available builds and defaults to the previous one. |

---

### `dm restart <name>`

Restart an application using its current active build.

```bash
dm restart <name>
```

---

### `dm stop <name>`

Stop a running application without removing it.

```bash
dm stop <name>
```

---

### `dm logs <name>`

Stream live PM2 logs for an application.

```bash
dm logs <name>
```

---

### `dm monit`

Open the PM2 monitor dashboard for all applications.

```bash
dm monit
```

---

### `dm info <name>`

Show detailed information about an application including port, status, build history, and attached storages.

```bash
dm info <name>
```

---

### `dm clean-all`

Discard uncommitted changes and prune old builds for all registered applications at once.

```bash
dm clean-all
```

---

### `dm set-url <name> <url>`

Set or update the public URL/domain for an application.

```bash
dm set-url <name> https://myapp.example.com
```

---

## Storage Volumes

Storages are persistent, named directories that live outside any individual build. They survive deploys, rollbacks, and restarts. Apps opt in by attaching a named storage; `dm` automatically creates a symlink inside each build directory so the app can read and write persistent files at a predictable path.

Common uses: user uploads, generated files, shared caches, SQLite databases.

### `dm storage new <name>`

Create a new named storage directory.

```bash
dm storage new uploads
```

The directory is created at `$STORAGE_DIR/<name>` (defaults to `<APP_DIR>/storages/<name>`).

---

### `dm storage attach <app> <storage>`

Attach a storage to an app. A symlink is immediately created in the app's active build if one exists.

```bash
dm storage attach my-app uploads
```

From that point on, every new build (deploy or rollback) will have a symlink at `<buildDir>/uploads → <STORAGE_DIR>/uploads`.

`dm` will refuse to attach if a real file or directory already exists at that path inside the active build — rename or remove it first.

---

### `dm storage detach <app> <storage>`

Remove the association between an app and a storage. The symlink in the active build is removed; future builds will no longer include it. The storage directory and its contents are left untouched.

```bash
dm storage detach my-app uploads
```

---

### `dm storage rm <name>`

Delete a storage entirely — removes the DB record and the directory from disk. The command will refuse if any app still has the storage attached; detach it from all apps first.

```bash
dm storage rm uploads
```

---

### `dm storage ls`

List all storages with their path, creation date, attached apps, and disk usage. A total row is shown at the bottom.

```bash
dm storage ls
```

---

### Storage and environment variable

By default storages live under `<APP_DIR>/storages/`. To place them on a different volume, set the `STORAGE_DIR` environment variable before starting `dm`.

```bash
export STORAGE_DIR=/mnt/data/storages
dm storage new uploads
```

---

### Typical workflow

```bash
# 1. Create the storage once
dm storage new uploads

# 2. Attach it to your app
dm storage attach my-app uploads

# 3. Deploy as normal — symlink is created automatically in each build
dm deploy my-app

# 4. Inspect storages at any time
dm storage ls
```

---

## How It Works

- Apps are tracked in a local database (lowdb) with metadata like port, repo, branch, build history, and last deploy time.
- Each command acquires a per-app lock to prevent concurrent operations on the same app.
- Deployment checks for git changes and env changes before deciding whether to rebuild, so unchanged apps are skipped unless `--force` is used.
- PM2 is used for process management — Next.js and NestJS apps run in cluster mode; .NET apps run in fork mode using the `dotnet` interpreter.
- Builds are versioned and stored; `clean` prunes old ones while preserving the active build.

---

## .NET Core API support

`dm` can manage ASP.NET Core APIs registered with `--type dotnet`.

### Requirements

- .NET SDK installed on the server and available on `PATH`
- A `.csproj` file at the repository root
- The `.csproj` assembly name (or filename stem) must match the `dm` app name — this is how dm locates the compiled DLL

### Deploy flow

```
1. dotnet --version check        ← SDK present and version ≥ <TargetFramework>
2. Assembly name pre-check       ← <AssemblyName> or .csproj stem matches app name
3. .env sync                     ← same as NestJS
4. appsettings sync              ← appsettings.json / appsettings.Production.json copied from env/ if changed
5. dotnet restore
6. dotnet publish -c Release -o ./publish
7. DLL verification              ← <appName>.dll must exist in publish output
8. Build snapshot                ← publish/ moved to builds/build-<timestamp>/publish/
9. PM2 start (fork mode)         ← dotnet <appName>.dll with ASPNETCORE_ENVIRONMENT=Production
```

### Example

```bash
dm init myapi --repo https://github.com/org/myapi --type dotnet
dm deploy myapi
```

### appsettings management

Place `appsettings.json` and/or `appsettings.Production.json` in the app's `env/` directory on the server. `dm deploy` will copy them into the release directory before building if they are new or changed. They flow into the build snapshot automatically via `dotnet publish`.

```
<APP_DIR>/myapi/env/
  appsettings.json             ← server-managed, never committed to repo
  appsettings.Production.json  ← production overrides
```
