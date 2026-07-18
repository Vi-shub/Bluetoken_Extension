import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { runCursorReader } from "./dbRunner";
import { SessionTracker } from "./sessionTracker";
import { calculateWater, getScopeConfig, getModelOverrides } from "./waterCalculator";
import { log } from "./log";
import { fingerprintFile } from "./pollUtils";

const LAST_TOKENS_KEY = "bluetoken.cursor.lastTotalTokens.v2";
const IMPORTED_KEY = "bluetoken.cursor.historyImported.v2";
const CURSOR_MODEL_ID = "cursor-chat";

export class CursorUsageReader {
  private timer: NodeJS.Timeout | undefined;
  private readonly scriptPath: string;
  private disposed = false;
  private busy = false;
  private consecutiveFailures = 0;
  private lastDbFingerprint: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: SessionTracker
  ) {
    this.scriptPath = context.asAbsolutePath(path.join("resources", "db-reader.js"));
  }

  /** All plausible Cursor state.vscdb locations (Windows/macOS/Linux). */
  static listCandidateDbs(): string[] {
    const home = os.homedir();
    const out: string[] = [];
    if (process.platform === "win32") {
      const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
      const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      out.push(
        path.join(appdata, "Cursor", "User", "globalStorage", "state.vscdb"),
        path.join(local, "Cursor", "User", "globalStorage", "state.vscdb")
      );
    } else if (process.platform === "darwin") {
      out.push(
        path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
      );
    } else {
      const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
      out.push(path.join(config, "Cursor", "User", "globalStorage", "state.vscdb"));
    }
    return out;
  }

  static locateDb(): string | null {
    for (const c of CursorUsageReader.listCandidateDbs()) {
      try {
        if (fs.existsSync(c)) {
          return c;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  isAvailable(): boolean {
    return CursorUsageReader.locateDb() !== null;
  }

  start(intervalMs = 5000): void {
    log.info(`Cursor reader start available=${this.isAvailable()} intervalMs=${intervalMs}`);
    // Always poll — DB may appear later after Cursor creates storage.
    setTimeout(() => void this.poll(false), 500);
    this.timer = setInterval(() => void this.poll(false), intervalMs);
  }

  async refreshNow(): Promise<{ delta: number; total: number } | null> {
    return this.poll(true);
  }

  private async poll(announce: boolean): Promise<{ delta: number; total: number } | null> {
    if (this.disposed) {
      return null;
    }
    if (this.busy && !announce) {
      return null;
    }

    const dbPath = CursorUsageReader.locateDb();
    if (!dbPath) {
      log.warn(`Cursor DB not found. Tried: ${CursorUsageReader.listCandidateDbs().join(" | ")}`);
      if (announce) {
        vscode.window.showWarningMessage("BlueToken: Cursor state.vscdb not found on this machine.");
      }
      return null;
    }

    if (!fs.existsSync(this.scriptPath)) {
      log.error(`Cursor reader script missing: ${this.scriptPath}`);
      return null;
    }

    const fp = fingerprintFile(dbPath);
    if (!announce && fp && fp === this.lastDbFingerprint) {
      return null;
    }

    this.busy = true;
    try {
      const result = await runCursorReader(this.scriptPath, dbPath, 45000);
      if (!result.ok || result.inputTokens === undefined) {
        this.consecutiveFailures++;
        log.error(`Cursor poll failed (#${this.consecutiveFailures}): ${result.error}`);
        if (announce || this.consecutiveFailures === 1 || this.consecutiveFailures === 5) {
          vscode.window.showWarningMessage(
            `BlueToken: Cursor chat reader failed (${result.error ?? "unknown"}). See Output → BlueToken.`
          );
        }
        return null;
      }
      this.consecutiveFailures = 0;
      if (fp) {
        this.lastDbFingerprint = fp;
      }

      const currentTotal = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      const scope = getScopeConfig();
      const overrides = getModelOverrides();
      const estimated = result.estimatedBubbles ?? 0;
      const source = estimated > 0 ? "Cursor chat (exact+est.)" : "Cursor chat (exact)";

      const imported = this.context.globalState.get<boolean>(IMPORTED_KEY, false);
      const lastTotal = this.context.globalState.get<number>(LAST_TOKENS_KEY, 0);

      if (!imported || lastTotal === 0) {
        if (!imported && currentTotal > 0) {
          const historyWater = calculateWater(currentTotal, CURSOR_MODEL_ID, scope, overrides).totalMl;
          this.session.addAllTime(currentTotal, historyWater);
          log.info(`Cursor history imported to all-time: ${currentTotal} tokens`);
        }
        await this.context.globalState.update(IMPORTED_KEY, true);
        await this.context.globalState.update(LAST_TOKENS_KEY, currentTotal);
        if (announce) {
          vscode.window.showInformationMessage(
            `BlueToken: Cursor baseline set (${currentTotal.toLocaleString()} tokens).`
          );
        }
        return { delta: 0, total: currentTotal };
      }

      const delta = currentTotal - lastTotal;
      if (delta > 0) {
        const water = calculateWater(delta, CURSOR_MODEL_ID, scope, overrides);
        this.session.record(water, source);
        await this.context.globalState.update(LAST_TOKENS_KEY, currentTotal);
        log.info(`Cursor +${delta} tokens (${source})`);
        if (announce) {
          vscode.window.showInformationMessage(
            `BlueToken: +${water.formattedAmount} | ${delta.toLocaleString()} tokens from Cursor chat.`
          );
        }
        return { delta, total: currentTotal };
      }

      if (delta < 0) {
        await this.context.globalState.update(LAST_TOKENS_KEY, currentTotal);
        log.warn(`Cursor total shrank ${lastTotal} → ${currentTotal}; baseline resynced`);
      }

      if (announce) {
        vscode.window.showInformationMessage(
          `BlueToken: No new Cursor tokens (total ${currentTotal.toLocaleString()}).`
        );
      }
      return { delta: 0, total: currentTotal };
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
