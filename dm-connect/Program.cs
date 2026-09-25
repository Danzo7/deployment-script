using DmConnect;

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
            if (args[i].StartsWith('-'))
            {
                UI.Error($"Unknown argument: {args[i]}");
                PrintUsage();
                return 1;
            }
            
            if (host is null)
                host = args[i];
            else
                // After host is set, remaining args are the remote command
                command.Add(args[i]);
            break;
    }
}

if (host is null)
{
    // If no args were given at all, prompt interactively with server selection
    if (args.Length == 0)
    {
        var selectedServer = ServerManager.SelectServer();
        
        if (selectedServer is null)
        {
            Console.WriteLine("  Press any key to exit...");
            Console.ReadKey(intercept: true);
            return 1;
        }

        host = selectedServer.host;
        port = selectedServer.port;
        
        Console.WriteLine();
        UI.Info($"Connecting to '{selectedServer.name}' ({host}:{port})...");
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

// Save server name if it's from interactive mode
string? serverName = null;
if (args.Length == 0)
{
    var saved = ServerManager.Load();
    var server = saved.servers.FirstOrDefault(s => s.host == host && s.port == port);
    serverName = server?.name;
}

int exitCode = 0;
bool retry = true;

while (retry)
{
    exitCode = SshSession.Connect(host, port, keyPath, command.Count > 0 ? command.ToArray() : null);

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
        UI.Info("Share the public key above with your server admin.");

        if (args.Length == 0)
        {
            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write("  Press Enter to retry or any other key to exit... ");
            Console.ResetColor();
            
            var key = Console.ReadKey(intercept: true);
            Console.WriteLine();
            
            if (key.Key == ConsoleKey.Enter)
            {
                Console.WriteLine();
                UI.Info("Retrying connection...");
                Console.WriteLine();
                continue;
            }
        }
        return 1;
    }
    
    // Connection succeeded or exit code is not connection failure
    retry = false;
}

// Update last connected server on successful connection
if (exitCode == 0 && serverName is not null)
{
    ServerManager.UpdateLastConnected(serverName);
}

if (args.Length == 0)
{
    Console.WriteLine("  Press any key to exit...");
    Console.ReadKey(intercept: true);
}

return exitCode;
