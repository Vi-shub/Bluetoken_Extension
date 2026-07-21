import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { runCursorReader } from "./dbRunner";
import { SessionTracker } from "./sessionTracker";
import { calculateWater, getScopeConfig, getModelOverrides } from "./waterCalculator";
import { log } from "./log";
import { fingerprintSqlite } from "./pollUtils";
import { markAiActivity, suppressDiskFileEditsFor } from "./aiActivity";

/** v3: chat totals exclude tool-edit bubble text (moved to file-edit metric). */
const LAST_TOKENS_KEY = "bluetoken.cursor.lastTotalTokens.v3";
const LAST_FILE_EDIT_KEY = "bluetoken.cursor.lastFileEditTokens.v3";
const IMPORTED_KEY = "bluetoken.cursor.historyImported.v3";
const CURSOR_MODEL_ID = "cursor-chat";
const CURSOR_AGENT_MODEL_ID = "cursor-agent";

export class CursorUsageReader {
  private timer: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private watcher: fs.FSWatcher | undefined;
  private readonly scriptPath: string;
  private disposed = false;
  private busy = false;
  private pollAgain = false;
  private consecutiveFailures = 0;
  private lastDbFingerprint: string | undefined;
  private pendingAnnounce = false;
  /** In-memory baselines — avoid globalState races across overlapping polls. */
  private memChatTotal: number | undefined;
  private memFileEditTotal: number | undefined;

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

  start(intervalMs = 3000): void {
    const ms = Math.max(2000, Math.min(intervalMs, 60_000));
    log.info(`Cursor reader start available=${this.isAvailable()} intervalMs=${ms}`);
    setTimeout(() => void this.poll(false), 300);
    this.timer = setInterval(() => void this.poll(false), ms);
    this.startFsWatch();
  }

  async refreshNow(): Promise<{ delta: number; total: number } | null> {
    return this.poll(true);
  }

  private startFsWatch(): void {
    const dbPath = CursorUsageReader.locateDb();
    if (!dbPath) {
      return;
    }
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    try {
      this.watcher = fs.watch(dir, (_event, filename) => {
        if (this.disposed) {
          return;
        }
        const name = filename?.toString() ?? "";
        if (
          !name ||
          name === base ||
          name === `${base}-wal` ||
          name === `${base}-shm` ||
          name.startsWith(base)
        ) {
          this.schedulePoll();
        }
      });
      log.debug(`Cursor fs.watch on ${dir}`);
    } catch (e) {
      log.warn(`Cursor fs.watch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private schedulePoll(): void {
    if (this.busy) {
      this.pollAgain = true;
      return;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.poll(false);
    }, 400);
  }

  private async setChatBaseline(total: number): Promise<void> {
    this.memChatTotal = total;
    await this.context.globalState.update(LAST_TOKENS_KEY, total);
  }

  private async setFileEditBaseline(total: number): Promise<void> {
    this.memFileEditTotal = total;
    await this.context.globalState.update(LAST_FILE_EDIT_KEY, total);
  }

  private async poll(announce: boolean): Promise<{ delta: number; total: number } | null> {
    if (this.disposed) {
      return null;
    }
    if (announce) {
      this.pendingAnnounce = true;
    }
    if (this.busy) {
      this.pollAgain = true;
      return null;
    }

    // Lock immediately so interval + fs.watch cannot overlap.
    this.busy = true;
    this.pollAgain = false;

    try {
      const dbPath = CursorUsageReader.locateDb();
      if (!dbPath) {
        log.warn(`Cursor DB not found. Tried: ${CursorUsageReader.listCandidateDbs().join(" | ")}`);
        if (this.pendingAnnounce) {
          this.pendingAnnounce = false;
          vscode.window.showWarningMessage("BlueToken: Cursor state.vscdb not found on this machine.");
        }
        return null;
      }

      if (!fs.existsSync(this.scriptPath)) {
        log.error(`Cursor reader script missing: ${this.scriptPath}`);
        if (this.pendingAnnounce) {
          this.pendingAnnounce = false;
          vscode.window.showWarningMessage(
            "BlueToken: Cursor reader script missing. Reinstall the extension."
          );
        }
        return null;
      }

      const fp = fingerprintSqlite(dbPath);
      const wantAnnounce = this.pendingAnnounce;
      if (!wantAnnounce && fp && fp === this.lastDbFingerprint) {
        return null;
      }

      this.pendingAnnounce = false;
      const result = await runCursorReader(this.scriptPath, dbPath, 45000);
      if (!result.ok || result.inputTokens === undefined) {
        this.consecutiveFailures++;
        log.error(`Cursor poll failed (#${this.consecutiveFailures}): ${result.error}`);
        if (wantAnnounce || this.consecutiveFailures === 1 || this.consecutiveFailures === 5) {
          vscode.window.showWarningMessage(
            `BlueToken: Cursor chat reader failed (${result.error ?? "unknown"}). See Output → BlueToken.`
          );
        }
        return null;
      }
      this.consecutiveFailures = 0;
      this.lastDbFingerprint = fingerprintSqlite(dbPath) ?? fp ?? undefined;

      const currentTotal = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      const currentFileEdit = result.fileEditTokens ?? 0;
      const scope = getScopeConfig();
      const overrides = getModelOverrides();
      const estimated = result.estimatedBubbles ?? 0;
      const source = estimated > 0 ? "Cursor chat (exact+est.)" : "Cursor chat (exact)";

      const imported = this.context.globalState.get<boolean>(IMPORTED_KEY, false);
      const lastTotal =
        this.memChatTotal ?? this.context.globalState.get<number>(LAST_TOKENS_KEY, 0);
      const storedFileEdit = this.context.globalState.get<number | undefined>(
        LAST_FILE_EDIT_KEY,
        undefined
      );
      const lastFileEdit = this.memFileEditTotal ?? storedFileEdit;

      // Fresh install or v3 migration (new keys) — baseline only, no session flood.
      if (!imported || lastTotal === 0) {
        if (!imported && currentTotal > 0) {
          const historyWater = calculateWater(currentTotal, CURSOR_MODEL_ID, scope, overrides).totalMl;
          this.session.addAllTime(currentTotal, historyWater);
          log.info(`Cursor history imported to all-time: ${currentTotal} tokens`);
        }
        if (lastFileEdit === undefined && currentFileEdit > 0) {
          const feWater = calculateWater(
            currentFileEdit,
            CURSOR_AGENT_MODEL_ID,
            scope,
            overrides
          ).totalMl;
          this.session.addAllTime(currentFileEdit, feWater);
          log.info(`Cursor file-edit history imported to all-time: ${currentFileEdit} tokens`);
        }
        await this.context.globalState.update(IMPORTED_KEY, true);
        await this.setChatBaseline(currentTotal);
        await this.setFileEditBaseline(currentFileEdit);
        // Drop stale v2 baseline if present (accounting changed in 0.1.10).
        await this.context.globalState.update("bluetoken.cursor.lastTotalTokens.v2", undefined);
        log.info(
          `Cursor v3 baseline set chat=${currentTotal} fileEdit=${currentFileEdit} (tools=${result.fileEditFromTools ?? 0} diffs=${result.fileEditFromDiffs ?? 0})`
        );
        if (wantAnnounce) {
          vscode.window.showInformationMessage(
            `BlueToken: Cursor baseline set (${currentTotal.toLocaleString()} tokens).`
          );
        }
        return { delta: 0, total: currentTotal };
      }

      if (lastFileEdit === undefined) {
        await this.setFileEditBaseline(currentFileEdit);
      } else {
        const fileDelta = currentFileEdit - lastFileEdit;
        if (fileDelta > 0) {
          const water = calculateWater(fileDelta, CURSOR_AGENT_MODEL_ID, scope, overrides);
          this.session.record(water, "Cursor AI edit in file (db)");
          markAiActivity();
          suppressDiskFileEditsFor(8_000);
          await this.setFileEditBaseline(currentFileEdit);
          log.info(
            `Cursor AI edit in file (db): +${fileDelta} tokens (tools=${result.fileEditFromTools ?? 0} diffs=${result.fileEditFromDiffs ?? 0})`
          );
        } else if (fileDelta < 0) {
          await this.setFileEditBaseline(currentFileEdit);
          log.warn(
            `Cursor file-edit total shrank ${lastFileEdit} → ${currentFileEdit}; baseline resynced`
          );
        }
      }

      const delta = currentTotal - lastTotal;
      if (delta > 0) {
        const water = calculateWater(delta, CURSOR_MODEL_ID, scope, overrides);
        this.session.record(water, source);
        markAiActivity();
        await this.setChatBaseline(currentTotal);
        log.info(`Cursor +${delta} tokens (${source})`);
        if (wantAnnounce) {
          vscode.window.showInformationMessage(
            `BlueToken: +${water.formattedAmount} | ${delta.toLocaleString()} tokens from Cursor chat.`
          );
        }
        return { delta, total: currentTotal };
      }

      if (delta < 0) {
        await this.setChatBaseline(currentTotal);
        log.info(
          `Cursor chat baseline resynced ${lastTotal} → ${currentTotal} (method/accounting change)`
        );
      }

      if (wantAnnounce) {
        vscode.window.showInformationMessage(
          `BlueToken: No new Cursor tokens (total ${currentTotal.toLocaleString()}).`
        );
      }
      return { delta: 0, total: currentTotal };
    } finally {
      this.busy = false;
      if (this.pollAgain && !this.disposed) {
        this.pollAgain = false;
        setTimeout(() => void this.poll(false), 300);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore */
      }
      this.watcher = undefined;
    }
  }
}
