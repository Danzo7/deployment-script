import chalk from 'chalk';

export class Logger {
  static isMuted = false;
  /**
   * Logs an informational message in blue.
   */
  static info(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.gray(`ℹ ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs a success message in green.
   */
  static success(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.green(`✔ ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs an error message in red.
   */
  static error(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.red(`✖ ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs a warning message in yellow.
   */
  static warn(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.yellow(`⚠ ${message}`), ...optionalParams);
    return this.nl();
  }

  /**
   * Logs an advice message in italic white.
   */
  static advice(message?: any, ...optionalParams: any[]) {
    if (Logger.isMuted) return;
    this.log(chalk.italic.bold.whiteBright(`💡 ${message}`), ...optionalParams);
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
  static async spinner<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
    const interval = setInterval(() => {
      process.stdout.write(`\r${timestamp} ${chalk.cyan(frames[i++ % frames.length])} ${label}`);
    }, 80);

    try {
      const result = await operation();
      clearInterval(interval);
      process.stdout.write(`\r${timestamp} ${chalk.green('✔')} ${label}\n\n`);
      return result;
    } catch (err) {
      clearInterval(interval);
      process.stdout.write(`\r${timestamp} ${chalk.red('✖')} ${label}\n\n`);
      throw err;
    }
  }

  /**
   * Private helper for consistent logging.
   */
  private static log(formattedMessage: string, ...optionalParams: any[]) {
    process.stdout.write(this.withTimestamp(formattedMessage));
    if (optionalParams.length) {
      console.log(...optionalParams);
    }
  }
}
