using System.Text.Json;

namespace DmConnect;

internal static class ServerManager
{
    private static string ConfigPath() =>
        Path.Combine(Path.GetTempPath(), "dm-connect-servers.json");

    public static SavedServers Load()
    {
        try
        {
            var path = ConfigPath();
            if (!File.Exists(path))
                return new SavedServers(new List<ServerConfig>(), null);

            var json = File.ReadAllText(path);
            var servers = JsonSerializer.Deserialize(json, AppJsonContext.Default.SavedServers);
            return servers ?? new SavedServers(new List<ServerConfig>(), null);
        }
        catch
        {
            return new SavedServers(new List<ServerConfig>(), null);
        }
    }

    public static void Save(SavedServers servers)
    {
        try
        {
            var path = ConfigPath();
            var json = JsonSerializer.Serialize(servers, AppJsonContext.Default.SavedServers);
            File.WriteAllText(path, json);
        }
        catch (Exception)
        {
            // Silently fail - not critical
        }
    }

    public static ServerConfig? SelectServer()
    {
        var saved = Load();
        
        if (saved.servers.Count == 0)
        {
            return PromptNewServer();
        }

        Console.WriteLine();
        UI.Info("Select a server to connect:");
        Console.WriteLine();

        // Display saved servers
        for (int i = 0; i < saved.servers.Count; i++)
        {
            var server = saved.servers[i];
            var isLast = server.name == saved.lastConnected;
            
            Console.ForegroundColor = isLast ? ConsoleColor.Green : ConsoleColor.White;
            Console.Write($"    [{i + 1}] ");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.Write(server.name);
            Console.ForegroundColor = ConsoleColor.Gray;
            Console.Write($"  ({server.host}:{server.port})");
            
            if (isLast)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.Write("  ◀ last");
            }
            Console.ResetColor();
            Console.WriteLine();
        }

        // Add "New Server" and "Remove Server" options
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine($"    [N] + New Server");
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine($"    [R] - Remove Server");
        Console.ResetColor();
        Console.WriteLine();

        // Prompt for selection
        Console.ForegroundColor = ConsoleColor.White;
        var defaultChoice = saved.lastConnected != null
            ? (saved.servers.FindIndex(s => s.name == saved.lastConnected) + 1).ToString()
            : "1";
        
        Console.Write($"  Choice [default: {defaultChoice}]: ");
        Console.ResetColor();

        var input = Console.ReadLine()?.Trim();

        // Handle default
        if (string.IsNullOrEmpty(input))
            input = defaultChoice;

        // Handle "N" or "n" for new server
        if (input.Equals("n", StringComparison.OrdinalIgnoreCase))
        {
            return PromptNewServer();
        }

        // Handle "R" or "r" for remove server
        if (input.Equals("r", StringComparison.OrdinalIgnoreCase))
        {
            if (PromptRemoveServer())
            {
                // After removal, show selection menu again
                return SelectServer();
            }
            return null;
        }

        // Handle numeric selection
        if (int.TryParse(input, out int choice) && choice > 0 && choice <= saved.servers.Count)
        {
            return saved.servers[choice - 1];
        }

        UI.Error("Invalid selection.");
        return null;
    }

    public static ServerConfig? PromptNewServer()
    {
        Console.WriteLine();
        UI.Info("Add New Server");
        Console.WriteLine();

        // Prompt for name
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("  Server name: ");
        Console.ResetColor();
        var name = Console.ReadLine()?.Trim();

        if (string.IsNullOrEmpty(name))
        {
            UI.Error("Server name is required.");
            return null;
        }

        // Prompt for host
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("  Host (IP or hostname): ");
        Console.ResetColor();
        var host = Console.ReadLine()?.Trim();

        if (string.IsNullOrEmpty(host))
        {
            UI.Error("Host is required.");
            return null;
        }

        // Prompt for port
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("  Port [default: 2022]: ");
        Console.ResetColor();
        var portInput = Console.ReadLine()?.Trim();
        int port = 2022;

        if (!string.IsNullOrEmpty(portInput) && !int.TryParse(portInput, out port))
        {
            UI.Error("Invalid port number.");
            return null;
        }

        var server = new ServerConfig(name, host, port);

        // Save the new server
        var saved = Load();
        saved.servers.Add(server);
        Save(saved);

        UI.Ok($"Server '{name}' added successfully!");
        return server;
    }

    public static void UpdateLastConnected(string serverName)
    {
        var saved = Load();
        saved = saved with { lastConnected = serverName };
        Save(saved);
    }

    public static bool PromptRemoveServer()
    {
        var saved = Load();

        if (saved.servers.Count == 0)
        {
            UI.Warn("No servers to remove.");
            Console.WriteLine("  Press any key to continue...");
            Console.ReadKey(intercept: true);
            return false;
        }

        Console.WriteLine();
        UI.Warn("Remove a Server");
        Console.WriteLine();

        // Display servers with numbers
        for (int i = 0; i < saved.servers.Count; i++)
        {
            var server = saved.servers[i];
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"    [{i + 1}] ");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.Write(server.name);
            Console.ForegroundColor = ConsoleColor.Gray;
            Console.WriteLine($"  ({server.host}:{server.port})");
            Console.ResetColor();
        }

        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.WriteLine($"    [C] Cancel");
        Console.ResetColor();
        Console.WriteLine();

        // Prompt for selection
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("  Server to remove: ");
        Console.ResetColor();

        var input = Console.ReadLine()?.Trim();

        // Handle cancel
        if (string.IsNullOrEmpty(input) || input.Equals("c", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        // Handle numeric selection
        if (int.TryParse(input, out int choice) && choice > 0 && choice <= saved.servers.Count)
        {
            var serverToRemove = saved.servers[choice - 1];
            
            // Confirm removal
            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.Write($"  Remove '{serverToRemove.name}' ({serverToRemove.host}:{serverToRemove.port})? (yes/no) ");
            Console.ResetColor();
            var confirm = Console.ReadLine()?.Trim();

            if (confirm?.Equals("yes", StringComparison.OrdinalIgnoreCase) == true ||
                confirm?.Equals("y", StringComparison.OrdinalIgnoreCase) == true)
            {
                saved.servers.RemoveAt(choice - 1);
                
                // Clear lastConnected if we removed that server
                if (saved.lastConnected == serverToRemove.name)
                {
                    saved = saved with { lastConnected = null };
                }
                
                Save(saved);
                UI.Ok($"Server '{serverToRemove.name}' removed.");
                Console.WriteLine();
                return true;
            }
            else
            {
                UI.Info("Removal cancelled.");
                return false;
            }
        }

        UI.Error("Invalid selection.");
        return false;
    }
}
