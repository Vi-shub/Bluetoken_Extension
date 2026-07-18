import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { runDbReader } from "./dbRunner";
import { SessionTracker } from "./sessionTracker";
import { calculateWater, getScopeConfig, getModelOverrides } from "./waterCalculator";
import { log } from "./log";
import { fingerprintDbDir } from "./pollUtils";

const LAST_TOKENS_KEY = "bluetoken.antigravity.lastTotalTokens.v4";
const IMPORTED_KEY = "bluetoken.antigravity.historyImported.v4";
const STEP_CURSOR_KEY = "bluetoken.antigravity.stepCursor.v4";
const AG_MODEL_ID = "gemini";

export class AntigravityUsageReader {
  private timer: NodeJS.Timeout | undefined;
  private readonly scriptPath: string;
  private disposed = false;
  private busy = false;
  private consecutiveFailures = 0;
  private lastDirFingerprint: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: SessionTracker
  ) {
    this.scriptPath = context.asAbsolutePath(path.join("resources", "ag-reader.js"));
  }

  /** Every plausible conversations directory we know about. */
  static listCandidateDirs(): string[] {
    const home = os.homedir();
    const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return [
      path.join(home, ".gemini", "antigravity-ide", "conversations"),
      path.join(home, ".gemini", "antigravity", "conversations"),
      path.join(home, ".antigravity-ide", "conversations"),
      path.join(home, ".antigravity", "conversations"),
      // Some installs put agent data under the IDE's Roaming folder
      path.join(appdata, "Antigravity IDE", "User", "globalStorage"),
      path.join(appdata, "Antigravity", "User", "globalStorage"),
      path.join(home, ".gemini", "antigravity-ide"),
      path.join(home, ".gemini", "antigravity"),
    ];
  }

  static locateConversationsDir(): string | null {
    for (const c of AntigravityUsageReader.listCandidateDirs()) {
      try {
        if (!fs.existsSync(c)) {
          continue;
        }
        // Prefer a folder that actually contains .db conversation files
        if (c.endsWith("conversations")) {
          const dbs = fs.readdirSync(c).filter((f) => f.endsWith(".db"));
          if (dbs.length > 0) {
            return c;
          }
          // empty conversations dir still usable (new install)
          return c;
        }
        // Search one level for conversations/
        const nested = path.join(c, "conversations");
        if (fs.existsSync(nested)) {
          return nested;
        }
        // Or any .db directly in this folder
        const dbs = fs.readdirSync(c).filter((f) => f.endsWith(".db"));
        if (dbs.length > 0) {
          return c;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  isAvailable(): boolean {
    return AntigravityUsageReader.locateConversationsDir() !== null;
  }

  start(intervalMs = 5000): void {
    log.info(
      `Antigravity reader start available=${this.isAvailable()} dir=${AntigravityUsageReader.locateConversationsDir()}`
    );
    setTimeout(() => void this.poll(), 600);
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  async refreshNow(): Promise<void> {
    await this.poll(true);
  }

  private countMode(): "outputOnly" | "incremental" | "fullApi" {
    const mode = vscode.workspace
      .getConfiguration("bluetoken")
      .get<string>("antigravityCountMode", "outputOnly");
    if (mode === "fullApi") {
      return "fullApi";
    }
    if (mode === "incremental") {
      return "incremental";
    }
    return "outputOnly";
  }

  private async poll(announce = false): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.busy && !announce) {
      return;
    }

    const dir = AntigravityUsageReader.locateConversationsDir();
    if (!dir) {
      log.warn(
        `Antigravity conversations not found. Tried: ${AntigravityUsageReader.listCandidateDirs().join(" | ")}`
      );
      if (announce) {
        vscode.window.showWarningMessage(
          "BlueToken: Antigravity conversations folder not found. See Output → BlueToken."
        );
      }
      return;
    }

    if (!fs.existsSync(this.scriptPath)) {
      log.error(`Antigravity script missing: ${this.scriptPath}`);
      return;
    }

    const dirFp = fingerprintDbDir(dir);
    if (!announce && dirFp && dirFp === this.lastDirFingerprint) {
      return;
    }

    this.busy = true;
    try {
      const mode = this.countMode();
      const result = await runDbReader(this.scriptPath, dir, 45000, [mode]);
      if (!result.ok || result.inputTokens === undefined || result.outputTokens === undefined) {
        this.consecutiveFailures++;
        log.error(`Antigravity poll failed (#${this.consecutiveFailures}): ${result.error}`);
        if (announce || this.consecutiveFailures === 1 || this.consecutiveFailures === 5) {
          vscode.window.showWarningMessage(
            `BlueToken: Antigravity reader failed (${result.error ?? "unknown"}). See Output → BlueToken.`
          );
        }
        return;
      }
      this.consecutiveFailures = 0;
      if (dirFp) {
        this.lastDirFingerprint = dirFp;
      }

      const currentTotal = result.inputTokens + result.outputTokens;
      const events = result.events ?? [];
      const scope = getScopeConfig();
      const overrides = getModelOverrides();

      const imported = this.context.globalState.get<boolean>(IMPORTED_KEY, false);
      const lastTotal = this.context.globalState.get<number>(LAST_TOKENS_KEY, 0);
      const stepCursor = this.context.globalState.get<Record<string, number>>(STEP_CURSOR_KEY, {});

      log.debug(
        `Antigravity poll total=${currentTotal} events=${events.length} mode=${mode} imported=${imported}`
      );

      if (!imported || lastTotal === 0) {
        if (!imported && currentTotal > 0) {
          const historyWater = calculateWater(currentTotal, AG_MODEL_ID, scope, overrides).totalMl;
          this.session.addAllTime(currentTotal, historyWater);
          log.info(`Antigravity history imported: ${currentTotal} tokens`);
        }
        const nextCursor: Record<string, number> = { ...stepCursor };
        for (const e of events) {
          nextCursor[e.sessionId] = Math.max(nextCursor[e.sessionId] ?? -1, e.idx);
        }
        await this.context.globalState.update(IMPORTED_KEY, true);
        await this.context.globalState.update(LAST_TOKENS_KEY, currentTotal);
        await this.context.globalState.update(STEP_CURSOR_KEY, nextCursor);
        if (announce) {
          vscode.window.showInformationMessage(
            `BlueToken: Antigravity baseline set (${currentTotal.toLocaleString()} tokens).`
          );
        }
        return;
      }

      const nextCursor: Record<string, number> = { ...stepCursor };
      let recorded = 0;

      for (const e of events) {
        const lastIdx = nextCursor[e.sessionId] ?? -1;
        if (e.idx <= lastIdx) {
          continue;
        }
        if (e.tokens > 0) {
          const water = calculateWater(e.tokens, AG_MODEL_ID, scope, overrides);
          this.session.record(water, "Antigravity chat (exact)", e.atMs > 0 ? e.atMs : undefined);
          recorded += e.tokens;
          log.info(
            `Antigravity +${e.tokens} tokens @ ${e.atMs || "now"} (session ${e.sessionId.slice(0, 8)} idx ${e.idx})`
          );
        }
        nextCursor[e.sessionId] = e.idx;
      }

      if (currentTotal !== lastTotal) {
        await this.context.globalState.update(LAST_TOKENS_KEY, currentTotal);
      }
      await this.context.globalState.update(STEP_CURSOR_KEY, nextCursor);

      if (recorded === 0 && currentTotal > lastTotal) {
        const water = calculateWater(currentTotal - lastTotal, AG_MODEL_ID, scope, overrides);
        this.session.record(water, "Antigravity chat (exact)");
        log.warn(`Antigravity fallback delta +${currentTotal - lastTotal} (no new events matched)`);
      }

      if (announce) {
        if (recorded > 0) {
          vscode.window.showInformationMessage(
            `BlueToken: +${recorded.toLocaleString()} Antigravity tokens.`
          );
        } else {
          vscode.window.showInformationMessage(
            `BlueToken: No new Antigravity tokens (total ${currentTotal.toLocaleString()}).`
          );
        }
      }
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
