# Deployment Manager CLI

A comprehensive command-line tool designed to simplify the deployment and management of Next.js applications. The tool supports critical tasks such as application initialization, deployment, IIS reverse proxy configuration, and CI/CD workflow generation. It also maintains a database of registered applications for streamlined management.

---

## Key Features

### General
- **Application Database**: Maintains a centralized database of all registered applications, including their details (name, port, status, and deployment history).
- **List Applications**: View all registered applications with detailed information.
- **Initialize Applications**: Easily set up new applications with pre-configured repository, branch, instances, and ports.
- **Deploy Applications**: Deploy or update applications with optional force and linting flags to ensure quality and control.
- **Generate IIS Configurations**: Automatically create IIS reverse proxy configuration files for seamless server setup.
- **Application Status Management**: View or manage application statuses, such as checking if they are online, stopped, or launching.
- **CI/CD Workflow Integration**: Generate and push Gitea workflows to automate build and deployment pipelines.
- **Environment and Dependency Management**: Automatically handle environment variable setups and dependencies for consistent deployments.
- **Error Handling and Logging**: Robust error-handling and logging mechanisms ensure reliability and provide clear diagnostics.

### Advanced
- **PM2 Integration**: Leverages PM2 for process management, including instance control and status monitoring.
- **Extensibility**: Modular design allows for easy customization and extension to meet specific project needs.

---

## Installation

Clone the repository, install dependencies, and link the CLI tool for global use:

```bash
git clone <repository-url>
cd <project-directory>
npm install
npm run build
npm link
```

---

## Usage

The tool is accessible via the `dm` command. Below are the primary commands and their descriptions.

### **List Applications**

View a list of all registered applications with detailed information.

```bash
dm list
```

---

### **Initialize an Application**

Set up a new application for deployment with required configurations.

```bash
dm init <name> --repo <repo-url> --branch <branch-name> --instances <number-of-instances> --port <port-number>
```

#### Options:
- `--name` (Required): Application name.
- `--repo` (Required): Repository URL.
- `--branch`: Target branch (default: `main`).
- `--instances`: Number of PM2 instances (default: 1).
- `--port`: Port number (default: dynamically assigned).

---

### **Deploy an Application**

Deploy or update an application with optional parameters for additional control.

```bash
dm deploy <name> --force --lint
```

#### Options:
- `--force`: Force deployment even if no changes are detected.
- `--lint`: Run linting as part of the deployment process.

---

### **Generate IIS Configurations**

Create IIS reverse proxy configurations for specified applications.

```bash
dm iis-config <name> --https --non-www
```

#### Options:
- `--https`: Include HTTPS redirection.
- `--non-www`: Redirect traffic to the non-WWW version of the domain.

---

### **Generate CI/CD Workflow**

Generate and push a CI/CD workflow file for Gitea integration.

```bash
dm workflow <name>
```

---
### **Hard Unlock a Locked Application**

Forcefully release a lock on an application by killing the associated process. This command is useful when an application is stuck or has an orphaned lock.

```bash
dm unlock <name>
```

---
### **Set environment variables**

Set or update an environment variable for an application.

```bash
dm set-env <name> <env>
```

---

## Why Use Deployment Manager CLI?

1. **Simplified Processes**: Automates tedious tasks such as IIS configuration, deployment, and workflow generation.
2. **Error Reduction**: Minimizes manual errors with predefined and tested scripts.
3. **Efficiency**: Saves time by streamlining application initialization, deployment, and monitoring.
4. **Scalability**: Provides tools for managing multiple applications with ease.
5. **Reliability**: Robust error handling, logging, and dependency management ensure smooth operation.
6. **Integration**: Leverages PM2 for process management and Gitea Actions for CI/CD automation.
7. **Flexibility**: Modular design allows for easy customization and extension to meet specific project needs.

---

This tool is a one-stop solution for managing Next.js applications in environments requiring robust deployment and monitoring capabilities, especially when integrated with IIS and PM2.