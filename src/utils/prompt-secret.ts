import readline from 'readline';

export async function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide input
    const stdin = process.stdin as any;
    const originalSetRawMode = stdin.setRawMode;
    
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }

    let input = '';
    
    process.stdout.write(prompt);

    stdin.on('data', (char: Buffer) => {
      const c = char.toString('utf8');

      switch (c) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          stdin.setRawMode && stdin.setRawMode(false);
          rl.close();
          process.stdout.write('\n');
          resolve(input.trim());
          break;
        case '\u0003': // Ctrl+C
          stdin.setRawMode && stdin.setRawMode(false);
          rl.close();
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007f': // Backspace
        case '\b':
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
          break;
        default:
          // Only accept printable characters
          if (c.charCodeAt(0) >= 32) {
            input += c;
          }
          break;
      }
    });
  });
}
