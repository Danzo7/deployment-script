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
