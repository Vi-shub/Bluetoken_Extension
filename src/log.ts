import * as vscode from "vscode";

/**
 * Central BlueToken log — View → Output → "BlueToken"
 * Use this on other machines to see why chat readers fail.
 */
class BlueTokenLogger {
  private channel: vscode.OutputChannel | undefined;

  init(context: vscode.ExtensionContext): void {
    this.channel = vscode.window.createOutputChannel("BlueToken");
    context.subscriptions.push(this.channel);
    this.info("BlueToken logger ready");
  }

  show(): void {
    this.channel?.show(true);
  }

  info(msg: string): void {
    this.write("INFO", msg);
  }

  warn(msg: string): void {
    this.write("WARN", msg);
  }

  error(msg: string): void {
    this.write("ERROR", msg);
  }

  debug(msg: string): void {
    this.write("DEBUG", msg);
  }

  private write(level: string, msg: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    this.channel?.appendLine(line);
  }
}

export const log = new BlueTokenLogger();
