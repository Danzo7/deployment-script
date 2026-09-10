namespace DmConnect;

internal static class UI
{
    public static void Info(string msg)
    {
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine($"  {msg}");
        Console.ResetColor();
    }

    public static void Ok(string msg)
    {
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine($"  {msg}");
        Console.ResetColor();
    }

    public static void Warn(string msg)
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine($"  {msg}");
        Console.ResetColor();
    }

    public static void Error(string msg)
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine($"  ERROR: {msg}");
        Console.ResetColor();
    }

    public static void KeyBox(string publicKey)
    {
        Console.WriteLine();
        Console.ForegroundColor = ConsoleColor.White;
        Console.WriteLine("  Your public key:");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.WriteLine("  " + new string('─', 55));
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine($"  {publicKey.Trim()}");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.WriteLine("  " + new string('─', 55));
        Console.ResetColor();
        Console.WriteLine();
    }

    public static bool Confirm(string question)
    {
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write($"  {question} (yes/no) ");
        Console.ResetColor();
        var answer = Console.ReadLine() ?? "";
        return answer.Trim().Equals("yes", StringComparison.OrdinalIgnoreCase)
            || answer.Trim().Equals("y",   StringComparison.OrdinalIgnoreCase);
    }
}
