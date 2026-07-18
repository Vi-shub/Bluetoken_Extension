import * as vscode from "vscode";
import { SessionStats } from "./sessionTracker";
import { formatWater } from "./waterCalculator";

/** Color thresholds for the status bar pill (session total in mL). */
const THRESHOLDS = {
  amber: 50,   // > 50 mL → amber
  red: 200,    // > 200 mL → red
};

export class BlueTokenStatusBar {
  private readonly item: vscode.StatusBarItem;
  private lastMl = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "bluetoken.showPanel";
    this.item.name = "BlueToken Water Usage";
    this.update({ totalMl: 0, totalTokens: 0, messageCount: 0, entries: [], sessionStartMs: Date.now(), allTimeMl: 0, allTimeTokens: 0 });
    this.item.show();
  }

  update(stats: SessionStats): void {
    const visible = vscode.workspace.getConfiguration("bluetoken").get<boolean>("showInStatusBar", true);
    if (!visible) {
      this.item.hide();
      return;
    }

    this.lastMl = stats.totalMl;
    const sessionLabel = formatWater(stats.totalMl);
    const lastEntry = stats.entries.at(-1);
    const lastLabel = lastEntry ? formatWater(lastEntry.mlUsed) : "n/a";

    this.item.text = `$(drop) ${sessionLabel}`;
    this.item.tooltip = this.buildTooltip(stats, lastLabel);
    this.item.backgroundColor = this.getBackgroundColor(stats.totalMl);
    this.item.show();
  }

  private buildTooltip(stats: SessionStats, lastLabel: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**BlueToken: AI Water Footprint**\n\n`);
    md.appendMarkdown(`Session total: **${formatWater(stats.totalMl)}** (${stats.totalMl.toFixed(2)} mL)\n\n`);
    md.appendMarkdown(`Last message: **${lastLabel}**\n\n`);
    md.appendMarkdown(`Messages: ${stats.messageCount}  |  Tokens: ${stats.totalTokens.toLocaleString()}\n\n`);
    if (stats.totalMl > 0) {
      const lastEntry = stats.entries.at(-1);
      if (lastEntry) {
        md.appendMarkdown(`_${lastEntry.comparison}_\n\n`);
      }
    }
    md.appendMarkdown(`All-time: **${formatWater(stats.allTimeMl)}**\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`Track a reply: select it, press **Ctrl+Alt+W**\n\n`);
    md.appendMarkdown(
      `[Track now](command:bluetoken.trackText) | [Open Panel](command:bluetoken.showPanel) | [Reset](command:bluetoken.resetSession)\n\n`
    );
    md.appendMarkdown(
      `[Research](command:bluetoken.openResearch) | [★ Star on GitHub](command:bluetoken.openGithub) | [Project](command:bluetoken.openProject)`
    );
    return md;
  }

  private getBackgroundColor(ml: number): vscode.ThemeColor | undefined {
    if (ml >= THRESHOLDS.red) {
      return new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    if (ml >= THRESHOLDS.amber) {
      return new vscode.ThemeColor("statusBarItem.prominentBackground");
    }
    return undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
