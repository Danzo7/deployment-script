using DmConnect;
using System.Text.Json;

// ── Last-connection config ────────────────────────────────────────────────────

static string ConfigPath() =>
    Path.Combine(Path.GetTempPath(), "dm-connect.json");

static (string? host, int port) LoadLastConfig()
{
    try
    {
        var path = ConfigPath();
        if (!File.Exists(path)) return (null, 2022);
        var json = File.ReadAllText(path);
        var doc  = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var h    = root.TryGetProperty("host", out var hp) ? hp.GetString() : null;
        var p    = root.TryGetProperty("port", out var pp) && pp.TryGetInt32(out var pv) ? pv : 2022;
        return (h, p);
    }
    catch { return (null, 2022); }
}

static void SaveLastConfig(string host, int port)
{
    try
    {
        var path = ConfigPath();
        var json = JsonSerializer.Serialize(new LastConfig(host, port), AppJsonContext.Default.LastConfig);
        File.WriteAllText(path, json);
    }
    catch (Exception ex)
    {
    }
}

// ── Argument parsing ──────────────────────────────────────────────────────────

static void PrintUsage()
{
    Console.WriteLine();
    Console.WriteLine("  dm-connect — dm remote client");
    Console.WriteLine();
    Console.WriteLine("  Usage:");
    Console.WriteLine("    dm-connect <host> [options] [command...]");
    Console.WriteLine();
    Console.WriteLine("  Options:");
    Console.WriteLine("    --port, -p <port>        Port to connect on (default: 2022)");
    Console.WriteLine("    --identity, -i <algo>    Key algorithm: ed25519 (default), ed25519_sk,");
    Console.WriteLine("                             ecdsa, ecdsa_sk");
    Console.WriteLine("    --help, -h               Show this help");
    Console.WriteLine();
    Console.WriteLine("  Examples:");
    Console.WriteLine("    dm-connect 192.168.1.10");
    Console.WriteLine("    dm-connect 192.168.1.10 --port 2022");
    Console.WriteLine("    dm-connect 192.168.1.10 --identity ecdsa");
    Console.WriteLine("    dm-connect 192.168.1.10 deploy myapp");
    Console.WriteLine("    dm-connect 192.168.1.10 -p 2022 logs myapp");
    Console.WriteLine();
}

string? host     = null;
int     port     = 2022;
string? identity = null;
var     command  = new List<string>();

for (int i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--help": case "-h":
            PrintUsage();
            return 0;

        case "--port": case "-p":
            if (++i >= args.Length || !int.TryParse(args[i], out port))
            {
                UI.Error("--port requires a numeric value.");
                return 1;
            }
            break;

        case "--identity": case "-i":
            if (++i >= args.Length)
            {
                UI.Error("--identity requires an algorithm name.");
                return 1;
            }
            identity = args[i];
            break;

        default:
            if (!args[i].StartsWith('-') && host is null)
                host = args[i];
            else
            {
                // After host is set, remaining args are the remote command
                if (host is not null)
                    command.Add(args[i]);
                else
                {
                    UI.Error($"Unknown argument: {args[i]}");
                    PrintUsage();
                    return 1;
                }
            }
            break;
    }
}

if (host is null)
{
    // If no args were given at all, we're likely double-clicked — prompt interactively.
    if (args.Length == 0)
    {
        var (lastHost, lastPort) = LoadLastConfig();
        port = lastPort;

        Console.WriteLine();
        UI.Info("dm-connect — dm remote client");
        Console.WriteLine();
        Console.ForegroundColor = ConsoleColor.White;
        if (lastHost is not null)
            Console.Write($"  Server host [default: {lastHost}]: ");
        else
            Console.Write("  Server host (IP or hostname): ");
        Console.ResetColor();
        var hostInput = Console.ReadLine()?.Trim();

        if (string.IsNullOrEmpty(hostInput))
        {
            if (lastHost is null)
            {
                UI.Error("No host entered.");
                Console.WriteLine("  Press any key to exit...");
                Console.ReadKey(intercept: true);
                return 1;
            }
            host = lastHost;
        }
        else
        {
            host = hostInput;
        }

        Console.ForegroundColor = ConsoleColor.White;
        Console.Write($"  Port [default: {port}]: ");
        Console.ResetColor();
        var portInput = Console.ReadLine()?.Trim();
        if (!string.IsNullOrEmpty(portInput))
        {
            if (!int.TryParse(portInput, out port))
            {
                UI.Error("Invalid port number.");
                Console.WriteLine("  Press any key to exit...");
                Console.ReadKey(intercept: true);
                return 1;
            }
        }

    }
    else
    {
        UI.Error("No host specified.");
        PrintUsage();
        return 1;
    }
}

// ── Pre-flight ────────────────────────────────────────────────────────────────

SshSession.AssertSshAvailable();

// ── Key resolution ────────────────────────────────────────────────────────────

string? keyPath = KeyManager.Resolve(identity);
if (keyPath is null)
    return 0; // user declined generation, message already printed

if (args.Length == 0)
{
    SaveLastConfig(host, port);
}

int exitCode = SshSession.Connect(host, port, keyPath, command.Count > 0 ? command.ToArray() : null);

// Save config after successful interactive session


if (exitCode == 255)
{
    Console.WriteLine();
    UI.Error("Connection failed. Possible causes:");
    Console.ForegroundColor = ConsoleColor.Gray;
    Console.WriteLine($"  - Server is not reachable at {host}:{port}");
    Console.WriteLine("  - Your public key is not authorized on the server");
    Console.ResetColor();
    Console.WriteLine();
    KeyManager.ShowPublicKey(keyPath);
    UI.Info("Share the public key above with your server admin, then try again.");

    if (args.Length == 0)
    {
        Console.WriteLine("  Press any key to exit...");
        Console.ReadKey(intercept: true);
    }
    return 1;
}

if (args.Length == 0)
{
    Console.WriteLine("  Press any key to exit...");
    Console.ReadKey(intercept: true);
}

return exitCode;
