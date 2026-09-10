# dm-connect

.NET console client for connecting to a dm remote server.
Produces a single self-contained executable — no runtime install needed on the target machine.

## Usage

```
dm-connect <host> [options]

Options:
  --port, -p <port>        Port to connect on (default: 2022)
  --identity, -i <algo>    Key algorithm: ed25519 (default), ed25519_sk,
                           ecdsa, ecdsa_sk, rsa (>=4096 bits)
  --help, -h               Show help
```

```
dm-connect 192.168.1.10
dm-connect 192.168.1.10 --port 2022
dm-connect 192.168.1.10 --identity ecdsa
```

## First time setup

1. Run `dm-connect <host>` — it probes `~/.ssh` for any supported key type.
2. If none is found, it offers to generate a new ed25519 key pair for you.
3. Copy the public key it prints and send it to your server admin (`dm remote add`).
4. Once the admin adds your key, run the same command again to connect.

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
