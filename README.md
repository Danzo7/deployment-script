
# Deployment Manager CLI

A command-line tool to manage the deployment and status of Next.js applications using PM2. This tool enables you to list all applications, check their statuses, restart or start applications, and view key deployment information in a well-organized table format.

## Features

- **List Applications**: View all applications in the system with details like name, port, last deployment time, and status.
- **Check Application Status**: Easily view the current status of each application (e.g., online, stopped, launching).
- **Start/Restart Applications**: Start or restart applications with the ability to force deployment and run linting.
- **Easy to Use**: Intuitive command-line interface for fast and efficient app management.

## Installation

To install the tool, clone the repository and install the dependencies.

```bash
git clone <repository-url>
cd <project-directory>
npm install
npm build
npm link
```

## Usage

Once installed, you can use the tool directly from the command line.

### List All Applications

To list all applications and their statuses:

```bash
dm list
```

### Deploy or Update an Application

To deploy or update an application:

```bash
dm deploy <app-name> --force --lint
```

- `--force`: Forces the deployment even if no changes are detected.
- `--lint`: Runs linting during the deployment process.

### Initialize a New Application

To initialize a new application:

```bash
dm init --name <app-name> --repo <repo-url> --branch <branch-name> --instances <number-of-instances> --port <port-number>
```





