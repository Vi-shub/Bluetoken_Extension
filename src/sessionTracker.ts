import * as vscode from "vscode";
import { WaterResult } from "./waterCalculator";
import { HostKind, entryBelongsToHost } from "./host";

export interface SessionEntry {
  timestamp: number;
  modelId: string;
  modelDisplayName: string;
  tokens: number;
  mlUsed: number;
  comparison: string;
  source: string;
}

export interface SessionStats {
  totalMl: number;
  totalTokens: number;
  messageCount: number;
  entries: SessionEntry[];
  sessionStartMs: number;
  allTimeMl: number;
  allTimeTokens: number;
}

const HISTORY_KEY = "bluetoken.history";
const ALL_TIME_ML_KEY = "bluetoken.allTimeMl";
const ALL_TIME_TOKENS_KEY = "bluetoken.allTimeTokens";
const SESSION_START_KEY = "bluetoken.sessionStart";

/** Max number of entries kept in persistent storage (rolling window). */
const MAX_STORED_ENTRIES = 500;

export class SessionTracker {
  private entries: SessionEntry[] = [];
  private sessionStartMs: number;
  private allTimeMl: number;
  private allTimeTokens: number;

  private readonly _onDidUpdate = new vscode.EventEmitter<SessionStats>();
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Restore previous session data from persistent storage.
    this.entries = context.globalState.get<SessionEntry[]>(HISTORY_KEY, []);
    this.sessionStartMs = context.globalState.get<number>(SESSION_START_KEY, Date.now());
    this.allTimeMl = context.globalState.get<number>(ALL_TIME_ML_KEY, 0);
    this.allTimeTokens = context.globalState.get<number>(ALL_TIME_TOKENS_KEY, 0);
  }

  /** Call once after subscriptions are wired so the panel/bar get initial data. */
  emitInitial(): void {
    this._onDidUpdate.fire(this.getStats());
  }

  record(result: WaterResult, source: string, timestampMs?: number): void {
    const entry: SessionEntry = {
      timestamp: timestampMs && timestampMs > 0 ? timestampMs : Date.now(),
      modelId: result.modelId,
      modelDisplayName: result.modelRate.displayName,
      tokens: result.tokens,
      mlUsed: result.totalMl,
      comparison: result.comparison,
      source,
    };

    this.entries.push(entry);

    // Update all-time counters.
    this.allTimeMl += result.totalMl;
    this.allTimeTokens += result.tokens;

    // Persist — keep only the latest MAX_STORED_ENTRIES.
    const toStore = this.entries.slice(-MAX_STORED_ENTRIES);
    void this.context.globalState.update(HISTORY_KEY, toStore);
    void this.context.globalState.update(ALL_TIME_ML_KEY, this.allTimeMl);
    void this.context.globalState.update(ALL_TIME_TOKENS_KEY, this.allTimeTokens);

    this._onDidUpdate.fire(this.getStats());
  }

  /**
   * Adds to the all-time totals WITHOUT touching the current session — used to
   * import pre-existing history (e.g. Cursor's exact lifetime token count) on
   * first run, so the lifetime footprint is shown without flooding the session.
   */
  addAllTime(tokens: number, ml: number): void {
    this.allTimeMl += ml;
    this.allTimeTokens += tokens;
    void this.context.globalState.update(ALL_TIME_ML_KEY, this.allTimeMl);
    void this.context.globalState.update(ALL_TIME_TOKENS_KEY, this.allTimeTokens);
    this._onDidUpdate.fire(this.getStats());
  }

  /**
   * Drop session rows that came from another IDE's chat reader.
   * Rebuilds all-time totals from remaining entries (best-effort cleanup).
   * Returns how many entries were removed.
   */
  keepOnlyHostEntries(host: HostKind): number {
    const before = this.entries.length;
    const kept = this.entries.filter((e) => entryBelongsToHost(e.source, host));
    const removed = before - kept.length;
    if (removed <= 0) {
      return 0;
    }

    this.entries = kept;
    this.allTimeMl = kept.reduce((s, e) => s + e.mlUsed, 0);
    this.allTimeTokens = kept.reduce((s, e) => s + e.tokens, 0);

    void this.context.globalState.update(HISTORY_KEY, this.entries.slice(-MAX_STORED_ENTRIES));
    void this.context.globalState.update(ALL_TIME_ML_KEY, this.allTimeMl);
    void this.context.globalState.update(ALL_TIME_TOKENS_KEY, this.allTimeTokens);
    this._onDidUpdate.fire(this.getStats());
    return removed;
  }

  getStats(): SessionStats {
    const totalMl = this.entries.reduce((s, e) => s + e.mlUsed, 0);
    const totalTokens = this.entries.reduce((s, e) => s + e.tokens, 0);
    return {
      totalMl,
      totalTokens,
      messageCount: this.entries.length,
      entries: [...this.entries],
      sessionStartMs: this.sessionStartMs,
      allTimeMl: this.allTimeMl,
      allTimeTokens: this.allTimeTokens,
    };
  }

  /** Reset the current session counter only (all-time totals are preserved). */
  resetSession(): void {
    this.entries = [];
    this.sessionStartMs = Date.now();
    void this.context.globalState.update(HISTORY_KEY, []);
    void this.context.globalState.update(SESSION_START_KEY, this.sessionStartMs);
    this._onDidUpdate.fire(this.getStats());
  }

  /** Wipe everything — session + all-time totals. */
  resetAllTime(): void {
    this.entries = [];
    this.sessionStartMs = Date.now();
    this.allTimeMl = 0;
    this.allTimeTokens = 0;
    void this.context.globalState.update(HISTORY_KEY, []);
    void this.context.globalState.update(SESSION_START_KEY, this.sessionStartMs);
    void this.context.globalState.update(ALL_TIME_ML_KEY, 0);
    void this.context.globalState.update(ALL_TIME_TOKENS_KEY, 0);
    this._onDidUpdate.fire(this.getStats());
  }

  dispose(): void {
    this._onDidUpdate.dispose();
  }
}
