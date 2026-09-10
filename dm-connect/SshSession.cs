using System.Diagnostics;

namespace DmConnect;

/// <summary>
/// Shells out to the system ssh.exe — same approach as dm-connect.ps1.
/// Host key verification (TOFU), known_hosts, and fingerprint prompts all
/// work natively because we're just wiring args to the real SSH client.
/// </summary>
internal static class SshSession
{
    /// <summary>
    /// Checks that ssh is on PATH, printing platform-appropriate install
    /// instructions if not found.
    /// </summary>
    public static void AssertSshAvailable()
    {
        var sshBinary = OperatingSystem.IsWindows() ? "ssh.exe" : "ssh";

        var found = Environment.GetEnvironmentVariable("PATH")!
            .Split(Path.PathSeparator)
            .Select(dir => Path.Combine(dir, sshBinary))
            .Any(File.Exists);

        if (found) return;

        UI.Error("ssh not found on PATH.");
        Console.WriteLine();
        Console.ForegroundColor = ConsoleColor.White;

        if (OperatingSystem.IsWindows())
        {
            Console.WriteLine("  Windows OpenSSH client is required. To install it:");
            Console.ForegroundColor = ConsoleColor.Gray;
            Console.WriteLine("  Settings -> Apps -> Optional Features -> OpenSSH Client");
            Console.WriteLine("  Or run in PowerShell (as Admin):");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0");
        }
        else if (OperatingSystem.IsMacOS())
        {
            Console.WriteLine("  OpenSSH client is required. To install it:");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("    brew install openssh");
        }
        else
        {
            Console.WriteLine("  OpenSSH client is required. To install it:");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("    apt install openssh-client   # Debian/Ubuntu");
            Console.WriteLine("    dnf install openssh          # Fedora/RHEL");
        }

        Console.ResetColor();
        Console.WriteLine();
        Environment.Exit(1);
    }

    /// <summary>
    /// Runs ssh.exe and returns its exit code.
    /// Exit code 255 means connection/auth failure.
    /// Forces PTY allocation (-tt) to ensure ANSI sequences work properly.
    /// </summary>
    /// <param name="host">Remote host to connect to</param>
    /// <param name="port">SSH port</param>
    /// <param name="keyPath">Path to private key</param>
    /// <param name="command">Optional command to execute remotely. If null, opens interactive shell.</param>
    public static int Connect(string host, int port, string keyPath, string[]? command = null)
    {
        // Clear console before connection so only REPL logs are visible after successful auth
        // Skip clearing if executing a command (user might want to see previous context)
        if (command is null)
            Console.Clear();
        
        var psi = new ProcessStartInfo
        {
            FileName = "ssh",
            UseShellExecute = false,
        };

        // Mirror the exact ssh args from dm-connect.ps1
        // Explicitly exclude ssh-rsa (RSA+SHA-1) from both host key and pubkey algorithms.
        // Use -tt to force PTY allocation even for exec mode, which ensures ANSI sequences work.
        foreach (var arg in new[]
        {
            "-tt",  // Force PTY allocation for proper ANSI handling
            "-p", port.ToString(),
            "-i", keyPath,
            "-o", "StrictHostKeyChecking=ask",
            "-o", "BatchMode=no",
            "-o", "IdentitiesOnly=yes",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            "-o", "HostKeyAlgorithms=-ssh-rsa",
            "-o", "PubkeyAcceptedAlgorithms=-ssh-rsa",
            $"dm@{host}",
        })
        {
            psi.ArgumentList.Add(arg);
        }

        // If command provided, append it after the user@host
        if (command is not null)
        {
            foreach (var arg in command)
            {
                psi.ArgumentList.Add(arg);
            }
        }

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start ssh.exe.");

        proc.WaitForExit();
        return proc.ExitCode;
    }
}
