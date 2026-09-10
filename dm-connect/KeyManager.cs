using System.Diagnostics;

namespace DmConnect;

/// <summary>
/// Resolves the client SSH key.
/// Default: ~/.ssh/id_dm_ed25519 (generated on first use).
/// Override: pass an allowed algorithm name via --identity (ed25519, ed25519_sk, ecdsa, ecdsa_sk).
/// </summary>
internal static class KeyManager
{
    private static string SshDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh");

    private const string DefaultKeyName = "id_dm_ed25519";

    private static string DefaultKeyPath => Path.Combine(SshDir, DefaultKeyName);

    // Allowed algorithm names → ~/.ssh key filenames.
    // Must stay in sync with ALGORITHM_KEY_MAP in ssh-client.ts.
    private static readonly Dictionary<string, string> AlgorithmKeyMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ed25519"]    = "id_ed25519",
        ["ed25519_sk"] = "id_ed25519_sk",
        ["ecdsa"]      = "id_ecdsa",
        ["ecdsa_sk"]   = "id_ecdsa_sk",
    };

    /// <summary>
    /// Returns the private key path to use.
    /// - No identity → use DefaultKeyPath, generate if missing.
    /// - Identity provided → must be an allowed algorithm name; errors if key not found.
    /// Returns null if the user declines generation (caller should exit 0).
    /// </summary>
    public static string? Resolve(string? identity)
    {
        if (identity is not null)
        {
            if (!AlgorithmKeyMap.TryGetValue(identity, out var filename))
            {
                UI.Error($"Unknown algorithm \"{identity}\". Allowed: {string.Join(", ", AlgorithmKeyMap.Keys)}");
                Environment.Exit(1);
            }

            var keyPath = Path.Combine(SshDir, filename);
            if (!File.Exists(keyPath))
            {
                UI.Error($"No key found at {keyPath}.");
                Console.WriteLine();
                UI.Info($"Generate one with:  ssh-keygen -t {identity} -f \"{keyPath}\"");
                Environment.Exit(1);
            }

            UI.Info($"Using key: {keyPath}");
            return keyPath;
        }

        // No identity — always use the default key, generate if missing.
        var defaultPath = DefaultKeyPath;

        if (File.Exists(defaultPath))
        {
            UI.Info($"Using key: {defaultPath}");
            return defaultPath;
        }

        // Default key not found — offer to generate it.
        Console.WriteLine();
        UI.Warn($"No dm key found at {defaultPath}.");
        Console.WriteLine();

        if (!UI.Confirm("Generate a new ed25519 key pair now?"))
        {
            Console.WriteLine();
            UI.Info("To generate a key manually, run:");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine($"    ssh-keygen -t ed25519 -f \"{defaultPath}\"");
            Console.ResetColor();
            Console.WriteLine();
            UI.Info($"Then share the public key ({defaultPath}.pub) with your server admin.");
            return null;
        }

        Directory.CreateDirectory(SshDir);

        Console.WriteLine();
        UI.Info("Generating ed25519 key pair...");
        RunSshKeygen(defaultPath);

        if (!File.Exists(defaultPath))
        {
            UI.Error("Key generation failed.");
            Environment.Exit(1);
        }

        UI.Ok($"Key generated: {defaultPath}");
        ShowPublicKey(defaultPath);

        UI.Warn("Share the public key above with your server admin before connecting.");
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("  Press Enter once your key has been authorized, or Ctrl+C to cancel. ");
        Console.ResetColor();
        Console.ReadLine();

        return defaultPath;
    }

    public static void ShowPublicKey(string privateKeyPath)
    {
        var pubPath = privateKeyPath + ".pub";
        if (!File.Exists(pubPath)) return;
        UI.KeyBox(File.ReadAllText(pubPath));
    }

    private static void RunSshKeygen(string outputPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "ssh-keygen",
            ArgumentList = { "-t", "ed25519", "-f", outputPath, "-N", "" },
            UseShellExecute = false,
        };

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start ssh-keygen.");
        proc.WaitForExit();

        if (proc.ExitCode != 0)
        {
            UI.Error($"ssh-keygen exited with code {proc.ExitCode}.");
            Environment.Exit(1);
        }
    }
}
