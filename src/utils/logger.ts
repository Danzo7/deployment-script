import chalk from 'chalk';
import { supportsUnicode } from './terminal-capabilities.js';

// Symbol fallbacks for legacy consoles that can't render Unicode/emoji.
// On Windows Server 2016 / conhost build 14393, non-BMP glyphs render as
// blank boxes — this is a hard OS limit, not fixable via chcp or registry.
const SYM = {
  info: supportsUnicode ? 'ℹ' : 'i',
  success: supportsUnicode ? '✔' : '+',
  error: supportsUnicode ? '✖' : 'x',
  warn: supportsUnicode ? '⚠' : '!',
  advice: supportsUnicode ? '💡' : '*',
} as const;

export class Logger {
  static isMuted = false;
  /**
   * Logs an informational message in gray.
   */
  static info(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.gray(`${SYM.info} ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs a success message in green.
   */
  static success(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.green(`${SYM.success} ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs an error message in red.
   */
  static error(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.red(`${SYM.error} ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs a warning message in yellow.
   */
  static warn(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.yellow(`${SYM.warn} ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs an advice message in italic white.
   */
  static advice(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(
      chalk.italic.bold.whiteBright(`${SYM.advice} ${message}`),
      ...optionalParams
    );
    return this.nl();
  }

  /**
   * Highlights important text in bold cyan.
   */
  static highlight(text: string) {
    return chalk.bold.cyan(text);
  }

  /**
   * Transforms a file system path into a clickable OSC 8 terminal hyperlink.
   * Falls back to the plain path in environments that don't support hyperlinks.
   */
  static fileLink(filePath: string, label?: string) {
    const url = `file://${filePath.replace(/\\/g, '/')}`;
    const display = label ?? filePath;
    return `\x1b]8;;${url}\x1b\\${chalk.cyan.underline(display)}\x1b]8;;\x1b\\`;
  }

  /**
   * Formats a command or code snippet in bold magenta.
   */
  static command(cmd: string) {
    return chalk.bold.magenta(`\`${cmd}\``);
  }

  /**
   * Adds a timestamp to a message for logging.
   */
  static withTimestamp(message: string) {
    const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
    return `${timestamp} ${message}`;
  }

  /**
   * Adds a line break for better formatting.
   */
  static nl() {
    process.stdout.write('\n');
    return this;
  }

  /**
   * Displays an inline spinner while an async operation runs.
   * Returns the result of the operation.
   */
  static async spinner<T>(
    label: string,
    operation: () => Promise<T>
  ): Promise<T> {
    // Braille spinner frames require Unicode; fall back to ASCII on legacy consoles
    const frames = supportsUnicode
      ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      : ['-', '\\', '|', '/'];
    let i = 0;
    const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
    const interval = setInterval(() => {
      process.stdout.write(
        `\r${timestamp} ${chalk.cyan(frames[i++ % frames.length])} ${label}`
      );
    }, 80);

    try {
      const result = await operation();
      clearInterval(interval);
      process.stdout.write(
        `\r${timestamp} ${chalk.green(SYM.success)} ${label}\n\n`
      );
      return result;
    } catch (err) {
      clearInterval(interval);
      process.stdout.write(
        `\r${timestamp} ${chalk.red(SYM.error)} ${label}\n\n`
      );
      throw err;
    }
  }

  /**
   * Prints a raw message to stdout with no timestamp, icon, or styling.
   * Respects isMuted. Use for pre-styled strings, table output, or blank lines.
   */
  static print(message: any = '') {
    if (Logger.isMuted) return this;
    process.stdout.write(String(message) + '\n');
    return this;
  }

  /**
   * Prints a pre-rendered table string (e.g. from cli-table3).
   * Alias for print() with clearer intent at call sites.
   */
  static table(tableString: string) {
    return this.print(tableString);
  }

  /**
   * Prints a labeled key/value detail row, matching the pattern used across
   * info, domain, and cert-status commands.
   * Example output:  "  Name               my-app"
   */
  static row(label: string, value: string, labelWidth = 18) {
    if (Logger.isMuted) return this;
    process.stdout.write(`  ${chalk.gray(label.padEnd(labelWidth))} ${value}\n`);
    return this;
  }

  /**
   * Prints a horizontal gray divider line.
   */
  static divider(width = 40) {
    if (Logger.isMuted) return this;
    process.stdout.write(chalk.gray('  ' + '─'.repeat(width)) + '\n');
    return this;
  }

  /**
   * Private helper for consistent logging.
   */
  private static log(formattedMessage: string, ...optionalParams: any[]) {
    process.stdout.write(this.withTimestamp(formattedMessage) + '\n');
    if (optionalParams.length) {
      process.stdout.write(optionalParams.map(String).join(' ') + '\n');
    }
  }
}
