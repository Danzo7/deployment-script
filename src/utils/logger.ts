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
   * Private helper for consistent logging.
   */
  private static log(formattedMessage: string, ...optionalParams: any[]) {
    process.stdout.write(this.withTimestamp(formattedMessage));
    if (optionalParams.length) {
      console.log(...optionalParams);
    }
  }
}
