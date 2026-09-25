# dm-connect

.NET console client for connecting to a dm remote server.
Produces a single self-contained executable — no runtime install needed on the target machine.

## Features

- **Server Management**: Save multiple servers with friendly names
- **Interactive Selection**: Choose from saved servers on startup
- **Last Connected**: Automatically defaults to your most recent server
- **Retry on Failure**: Press Enter to retry connection instead of exiting
- **SSH Key Management**: Auto-detects or generates SSH keys

## Usage

### Interactive Mode (Recommended)

Simply run without arguments to get an interactive server selection menu:

```bash
dm-connect
```

You'll see:
1. List of saved servers with the last connected one highlighted
2. Option to add a new server
3. Default selection of your last connected server

### Command-Line Mode

```
dm-connect <host> [options]

Options:
  --port, -p <port>        Port to connect on (default: 2022)
  --identity, -i <algo>    Key algorithm: ed25519 (default), ed25519_sk,
                           ecdsa, ecdsa_sk, rsa (>=4096 bits)
  --help, -h               Show help
```

Examples:
```bash
dm-connect 192.168.1.10
dm-connect 192.168.1.10 --port 2022
dm-connect 192.168.1.10 --identity ecdsa
```

## Server Management

### Saved Servers

When you run `dm-connect` without arguments:
- Your saved servers are listed with friendly names
- The last connected server is highlighted in green with a `◀ last` indicator
- Press the number to connect
- Press `N` to add a new server
- Press `R` to remove a server
- Press Enter to use the default (last connected server)

### Adding a Server

1. Run `dm-connect` without arguments
2. Press `N` for "New Server"
3. Enter:
   - Server name (e.g., "Production", "Dev Server")
   - Host (IP or hostname)
   - Port (default: 2022)

The server is saved and can be selected in future sessions.

### Removing a Server

1. Run `dm-connect` without arguments
2. Press `R` for "Remove Server"
3. Select the server number to remove
4. Confirm with `yes` or `y`

The server is permanently deleted from your saved list.

### Server Storage

Servers are saved in: `%TEMP%\dm-connect-servers.json` (Windows) or `/tmp/dm-connect-servers.json` (Linux/macOS)

## Connection Retry

If a connection fails (timeout, auth error, etc.):
- You'll see the error message and your public key
- Press **Enter** to retry the connection
- Press any other key to exit

Perfect for waiting on server setup or authorization!

## First Time Setup

1. Run `dm-connect` (or `dm-connect <host>`)
2. It probes `~/.ssh` for any supported key type
3. If none is found, it offers to generate a new ed25519 key pair
4. Copy the public key it prints and send it to your server admin
5. Admin runs `dm remote add` on the server to authorize your key
6. Press Enter to retry the connection — you're in!

## Building

```bash
# Debug run
dotnet run --project remote-client/dm-connect -- <host>

# Self-contained single-file binary (Windows x64)
dotnet publish remote-client/dm-connect -c Release -r win-x64

# Self-contained single-file binary (Linux x64)
dotnet publish remote-client/dm-connect -c Release -r linux-x64

# Self-contained single-file binary (macOS arm64)
dotnet publish remote-client/dm-connect -c Release -r osx-arm64
```

The output binary will be in `remote-client/dm-connect/bin/Release/net8.0/<rid>/publish/`.

## Requirements

- [.NET 9 SDK](https://dotnet.microsoft.com/download) to build
- `ssh-keygen` on PATH (comes with OpenSSH, pre-installed on Windows 10+, macOS, and most Linux distros) — only needed if you want dm-connect to generate a key for you
- No runtime required on the machine running the built binary (self-contained)

## Supported key types

| `--identity` value | `~/.ssh` file    | Notes                        |
|--------------------|------------------|------------------------------|
| `ed25519`          | `id_ed25519`     | Default, recommended         |
| `ed25519_sk`       | `id_ed25519_sk`  | FIDO2 hardware key (YubiKey) |
| `ecdsa`            | `id_ecdsa`       |                              |
| `ecdsa_sk`         | `id_ecdsa_sk`    | FIDO2 hardware key (YubiKey) |
| `rsa`              | `id_rsa`         | Must be ≥ 4096 bits          |
