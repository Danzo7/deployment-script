# Deployment Manager CLI

A comprehensive command-line tool to manage deployment and application configurations for Next.js applications, utilizing PM2 and IIS. This tool simplifies the process of initializing, deploying, and managing applications while offering features like IIS reverse proxy configuration.

---

## Features

### General
- **List Applications**: View all registered applications with details such as name, port, deployment time, and status.
- **Initialize Applications**: Set up new applications with configurations for repository, branch, instances, and ports.
- **Deploy Applications**: Deploy or update applications with optional force or linting flags.
- **Generate IIS Config**: Automatically create IIS reverse proxy configuration files for specified applications.
- **Status Management**: View or manage application statuses (e.g., online, stopped, launching).
- **Workflow generation**: Generate and push Gitea workflow to integrate with CI.
---

## Installation

Clone the repository, install dependencies, and link the CLI tool:

```bash
git clone <repository-url>
cd <project-directory>
npm install
npm run build
npm link
```

---

## Usage

Once installed, the tool is accessible via the `dm` command.

### **List Applications**
Displays a table of all applications along with their details.

```bash
dm list
```

---

### **Initialize an Application**

Set up a new application for deployment.

```bash
dm init <name> --repo <repo-url> --branch <branch-name> --instances <number-of-instances> --port <port-number>
```

#### Options:
- `--name` (Required): Name of the application.
- `--repo` (Required): Repository URL for the application.
- `--branch`: Branch to deploy (default: `main`).
- `--instances`: Number of PM2 instances to start (default: 1).
- `--port`: Port number (default: dynamically assigned).

---

### **Deploy an Application**

Deploy or update an existing application.

```bash
dm deploy <name> --force --lint
```

#### Options:
- `--force`: Force deployment even if no changes are detected.
- `--lint`: Run linting during the deployment process.

---

### **Generate IIS Config**

Create an IIS reverse proxy configuration for an application.

```bash
dm iis-config <name> --https --non-www
```

#### Options:
- `--https`: Include HTTPS redirection rules in the configuration.
- `--non-www`: Redirect all traffic to the non-WWW version of the domain.

---
### **Generate Workflow**

Generate a workflow file and push it to the remote repository.

```bash
dm workflow <name>
```
---
