import * as vscode from "vscode";
import { SessionTracker } from "./sessionTracker";
import { BlueTokenStatusBar } from "./statusBar";
import { BlueTokenPanel } from "./panel";
import { LMTracker } from "./lmTracker";
import { CursorUsageReader } from "./cursorReader";
import { CopilotUsageReader } from "./copilotReader";
import { AntigravityUsageReader } from "./antigravityReader";
import { log } from "./log";
import { runDiagnostics } from "./diagnose";
import { LINKS, isPlaceholderUrl } from "./links";

export function activate(context: vscode.ExtensionContext): void {
  log.init(context);
  log.info(`Activating BlueToken in ${vscode.env.appName}`);

  const sessionTracker = new SessionTracker(context);
  const statusBar = new BlueTokenStatusBar();

  void repairBulkHistoryImport(context, sessionTracker);

  const panelProvider = new BlueTokenPanel(context.extensionUri, sessionTracker);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("bluetoken.panel", panelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    sessionTracker.onDidUpdate((stats) => {
      statusBar.update(stats);
      panelProvider.push(stats);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluetoken.showPanel", () => {
      vscode.commands.executeCommand("bluetoken.panel.focus");
    }),

    vscode.commands.registerCommand("bluetoken.resetSession", () => {
      sessionTracker.resetSession();
      vscode.window.showInformationMessage("BlueToken: Session counter reset.");
      log.info("Session reset");
    }),

    vscode.commands.registerCommand("bluetoken.resetAllTime", () => {
      vscode.window
        .showWarningMessage(
          "Reset ALL-TIME water totals? This cannot be undone.",
          "Reset everything",
          "Cancel"
        )
        .then((choice) => {
          if (choice === "Reset everything") {
            sessionTracker.resetAllTime();
            vscode.window.showInformationMessage("BlueToken: All-time totals cleared.");
            log.info("All-time reset");
          }
        });
    }),

    vscode.commands.registerCommand("bluetoken.showLogs", () => {
      log.show();
    }),

    vscode.commands.registerCommand("bluetoken.diagnose", async () => {
      log.show();
      await runDiagnostics(context);
      vscode.window.showInformationMessage(
        "BlueToken: Diagnose complete. See Output → BlueToken (copy that log if reporting a bug)."
      );
    }),

    vscode.commands.registerCommand("bluetoken.openResearch", async () => {
      const pick = await vscode.window.showQuickPick(
        LINKS.papers.map((p) => ({ label: p.label, description: p.url, url: p.url })),
        { placeHolder: "Open a research paper about AI freshwater use" }
      );
      if (pick) {
        await vscode.env.openExternal(vscode.Uri.parse(pick.url));
      }
    }),

    vscode.commands.registerCommand("bluetoken.openGithub", async () => {
      const url = isPlaceholderUrl(LINKS.repository) ? LINKS.github : LINKS.repository;
      if (isPlaceholderUrl(url)) {
        vscode.window.showWarningMessage(
          "BlueToken: Set your GitHub URL in src/links.ts (and package.json), then rebuild."
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand("bluetoken.openProject", async () => {
      if (isPlaceholderUrl(LINKS.project)) {
        vscode.window.showWarningMessage(
          "BlueToken: Set your project URL in src/links.ts, then rebuild."
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(LINKS.project));
    })
  );

  const cfg = vscode.workspace.getConfiguration("bluetoken");
  const pollMs = Math.max(10, cfg.get<number>("pollIntervalSeconds", 20)) * 1000;

  const cursorReader = new CursorUsageReader(context, sessionTracker);
  const copilotReader = new CopilotUsageReader(context, sessionTracker);
  const antigravityReader = new AntigravityUsageReader(context, sessionTracker);

  const trackCursor = cfg.get<boolean>("trackCursorChat", true);
  const trackCopilot = cfg.get<boolean>("trackCopilotChat", true);
  const trackAg = cfg.get<boolean>("trackAntigravityChat", true);

  log.info(
    `Settings trackCursor=${trackCursor} trackCopilot=${trackCopilot} trackAntigravity=${trackAg} pollMs=${pollMs}`
  );
  log.info(
    `Availability cursor=${cursorReader.isAvailable()} copilot=${copilotReader.isAvailable()} antigravity=${antigravityReader.isAvailable()}`
  );

  // Always start enabled readers — they retry if paths appear later.
  if (trackCursor) {
    cursorReader.start(pollMs);
  }
  if (trackCopilot) {
    copilotReader.start(pollMs);
  }
  if (trackAg) {
    antigravityReader.start(pollMs);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("bluetoken.refresh", async () => {
      log.info("Manual refresh requested");
      await Promise.all([
        cursorReader.refreshNow(),
        copilotReader.refreshNow(),
        antigravityReader.refreshNow(),
      ]);
    })
  );

  const lmTracker = new LMTracker(sessionTracker);
  lmTracker.activate(context, { fileWatcher: true });

  context.subscriptions.push(
    { dispose: () => statusBar.dispose() },
    { dispose: () => sessionTracker.dispose() },
    { dispose: () => cursorReader.dispose() },
    { dispose: () => copilotReader.dispose() },
    { dispose: () => antigravityReader.dispose() }
  );

  setImmediate(() => {
    sessionTracker.emitInitial();
  });

  const installed = context.globalState.get<boolean>("bluetoken.installed");
  if (!installed) {
    void context.globalState.update("bluetoken.installed", true);
    vscode.window
      .showInformationMessage(
        "BlueToken is active. If chat tracking fails on a new machine, run BlueToken: Diagnose and check Output → BlueToken.",
        "Open Panel",
        "Diagnose"
      )
      .then((choice) => {
        if (choice === "Open Panel") {
          vscode.commands.executeCommand("bluetoken.panel.focus");
        }
        if (choice === "Diagnose") {
          vscode.commands.executeCommand("bluetoken.diagnose");
        }
      });
  }
}

export function deactivate(): void {}

async function repairBulkHistoryImport(
  context: vscode.ExtensionContext,
  session: SessionTracker
): Promise<void> {
  const FLAG = "bluetoken.repairedBulkImport.v1";
  if (context.globalState.get<boolean>(FLAG, false)) {
    return;
  }

  const stats = session.getStats();
  const hasBulk = stats.entries.some((e) => e.tokens >= 1_000_000);
  if (!hasBulk) {
    await context.globalState.update(FLAG, true);
    return;
  }

  session.resetAllTime();
  await context.globalState.update("bluetoken.cursor.historyImported", false);
  await context.globalState.update("bluetoken.cursor.lastTotalTokens", 0);
  await context.globalState.update("bluetoken.antigravity.historyImported", false);
  await context.globalState.update("bluetoken.antigravity.lastTotalTokens", 0);
  await context.globalState.update(FLAG, true);
  log.warn("Repaired bulk history import bug");

  vscode.window.showInformationMessage(
    "BlueToken: Fixed a display bug: lifetime history was wrongly shown as this session. All-time will re-import shortly; session starts fresh."
  );
}
