import chalk from 'chalk';

export class Logger {
  static info(message?: any, ...optionalParams: any[]) {
    process.stdout.write(chalk.blueBright(message), ...optionalParams);
    return this.nl();
  }
  static success(message?: any, ...optionalParams: any[]) {
    process.stdout.write(chalk.green(message), ...optionalParams);
    return this.nl();
  }
  static error(message?: any, ...optionalParams: any[]) {
    process.stdout.write(chalk.red(message), ...optionalParams);
    return this.nl();
  }
  static warn(message?: any, ...optionalParams: any[]) {
    process.stdout.write(chalk.yellow(message), ...optionalParams);
    return this.nl();
  }
  static advice(message?: any, ...optionalParams: any[]) {
    process.stdout.write(
      chalk.italic.bold.whiteBright(message),
      ...optionalParams,
    );
    return this.nl();
  }
  static nl() {
    process.stdout.write('\n');
    return this;
  }
}