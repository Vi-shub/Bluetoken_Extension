import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { SessionTracker } from "./sessionTracker";
import {
  calculateWater,
  estimateTokens,
  getScopeConfig,
  getModelOverrides,
} from "./waterCalculator";
import { log } from "./log";
import {
  fingerprintFiles,
  normalizePathKey,
  realPathSafe,
} from "./pollUtils";

const SEEN_KEY = "bluetoken.copilot.seen.v3";
const IMPORTED_KEY = "bluetoken.copilot.historyImported.v3";
const LAST_TOKENS_KEY = "bluetoken.copilot.lastTotalTokens.v3";

const COPILOT_MODEL_ID = "gpt-4o";

interface SeenState {
  /** file path → content fingerprint (size or line count) */
  files: Record<string, number>;
}

/**
 * Tracks GitHub Copilot / VS Code Chat usage from local session files.
 *
 * Locations (VS Code ≥1.109 often uses .jsonl):
 * - globalStorage/emptyWindowChatSessions/*.{json,jsonl}
 * - workspaceStorage/<id>/chatSessions/*.{json,jsonl}
 * - workspaceStorage/<id>/github.copilot-chat/transcripts/*
 * - workspaceStorage/<id>/GitHub.copilot-chat/transcripts/*
 */
export class CopilotUsageReader {
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private busy = false;
  private lastFingerprint: string | undefined;
  private cachedScan:
    | { total: number; seen: SeenState; detail: string; fingerprint: string }
    | undefined;
  private readonly userDataDirs: string[];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: SessionTracker
  ) {
    this.userDataDirs = CopilotUsageReader.locateAllUserDataDirs(context);
  }

  static locateUserDataDir(context: vscode.ExtensionContext): string | null {
    return CopilotUsageReader.locateAllUserDataDirs(context)[0] ?? null;
  }

  static locateAllUserDataDirs(context: vscode.ExtensionContext): string[] {
    const found = new Map<string, string>();
    const add = (p: string): void => {
      try {
        if (!fs.existsSync(p)) {
          return;
        }
        const real = realPathSafe(p);
        found.set(normalizePathKey(real), real);
      } catch {
        /* ignore */
      }
    };

    try {
      add(path.dirname(path.dirname(context.globalStorageUri.fsPath)));
    } catch {
      /* ignore */
    }

    const home = os.homedir();
    const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const extras = [
      path.join(appdata, "Code", "User"),
      path.join(appdata, "Code - Insiders", "User"),
      path.join(appdata, "Cursor", "User"),
      path.join(appdata, "Antigravity IDE", "User"),
      path.join(appdata, "Antigravity", "User"),
    ];
    if (process.platform === "darwin") {
      const support = path.join(home, "Library", "Application Support");
      extras.push(path.join(support, "Code", "User"), path.join(support, "Cursor", "User"));
    } else if (process.platform === "linux") {
      const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
      extras.push(path.join(config, "Code", "User"), path.join(config, "Cursor", "User"));
    }
    for (const e of extras) {
      add(e);
    }
    return [...found.values()];
  }

  isAvailable(): boolean {
    return this.userDataDirs.length > 0;
  }

  start(intervalMs = 20000): void {
    log.info(`Copilot reader start dirs=${this.userDataDirs.join(" | ")}`);
    // Stagger after Cursor/Antigravity so we don't stampede the disk together.
    setTimeout(() => void this.poll(), 7000);
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  async refreshNow(): Promise<void> {
    await this.poll(true);
  }

  private countMode(): "outputOnly" | "incremental" | "fullApi" {
    const mode = vscode.workspace
      .getConfiguration("bluetoken")
      .get<string>("copilotCountMode", "outputOnly");
    if (mode === "fullApi" || mode === "incremental") {
      return mode;
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
    if (this.userDataDirs.length === 0) {
      log.warn("Copilot: no user data dirs found");
      if (announce) {
        vscode.window.showWarningMessage("BlueToken: Could not locate VS Code/Copilot user data.");
      }
      return;
    }

    this.busy = true;
    try {
      const mode = this.countMode();
      const { total, seen, detail, fingerprint } = this.scanAll(mode, announce);
      if (fingerprint === this.lastFingerprint && !announce) {
        // Unchanged on disk — skip accounting work and noisy logs.
        return;
      }
      this.lastFingerprint = fingerprint;
      log.debug(`Copilot poll total=${total} mode=${mode} ${detail}`);

      const imported = this.context.globalState.get<boolean>(IMPORTED_KEY, false);
      const lastTotal = this.context.globalState.get<number>(LAST_TOKENS_KEY, 0);
      const scope = getScopeConfig();
      const overrides = getModelOverrides();

      if (!imported || lastTotal === 0) {
        if (!imported && total > 0) {
          const water = calculateWater(total, COPILOT_MODEL_ID, scope, overrides);
          this.session.addAllTime(total, water.totalMl);
          log.info(`Copilot history imported: ${total} tokens`);
        }
        await this.context.globalState.update(IMPORTED_KEY, true);
        await this.context.globalState.update(LAST_TOKENS_KEY, total);
        await this.context.globalState.update(SEEN_KEY, seen);
        if (announce) {
          vscode.window.showInformationMessage(
            `BlueToken: Copilot baseline set (${total.toLocaleString()} tokens).`
          );
        }
        return;
      }

      const delta = total - lastTotal;
      if (delta > 0) {
        const water = calculateWater(delta, COPILOT_MODEL_ID, scope, overrides);
        this.session.record(water, "Copilot chat (exact)");
        await this.context.globalState.update(LAST_TOKENS_KEY, total);
        log.info(`Copilot +${delta} tokens`);
        if (announce) {
          vscode.window.showInformationMessage(
            `BlueToken: +${water.formattedAmount} | ${delta.toLocaleString()} tokens from Copilot.`
          );
        }
      } else if (delta < 0) {
        await this.context.globalState.update(LAST_TOKENS_KEY, total);
        log.warn(`Copilot total shrank ${lastTotal} → ${total} (often after de-dupe; baseline resynced)`);
        if (announce) {
          vscode.window.showInformationMessage(
            `BlueToken: Copilot baseline resynced (${total.toLocaleString()} tokens).`
          );
        }
      } else if (announce) {
        vscode.window.showInformationMessage(
          `BlueToken: No new Copilot tokens (total ${total.toLocaleString()}). See Output → BlueToken.`
        );
      }

      await this.context.globalState.update(SEEN_KEY, seen);
    } finally {
      this.busy = false;
    }
  }

  /** Find every known Copilot/VS Code chat session file under a User dir. */
  static discoverSessionFiles(userDataDir: string): string[] {
    const out: string[] = [];

    const empty = path.join(userDataDir, "globalStorage", "emptyWindowChatSessions");
    CopilotUsageReader.collectSessionFilesInDir(empty, out);

    const wsRoot = path.join(userDataDir, "workspaceStorage");
    if (!fs.existsSync(wsRoot)) {
      return CopilotUsageReader.dedupeSessionFiles(out);
    }

    let wsFolders: string[];
    try {
      wsFolders = fs.readdirSync(wsRoot);
    } catch {
      return CopilotUsageReader.dedupeSessionFiles(out);
    }

    for (const ws of wsFolders) {
      const base = path.join(wsRoot, ws);
      CopilotUsageReader.collectSessionFilesInDir(path.join(base, "chatSessions"), out);
      // One casing only — on Windows github.* and GitHub.* are the same folder.
      CopilotUsageReader.collectSessionFilesInDir(path.join(base, "github.copilot-chat", "transcripts"), out);
      CopilotUsageReader.collectSessionFilesInDir(path.join(base, "github.copilot-chat", "chatSessions"), out);
    }

    return CopilotUsageReader.dedupeSessionFiles(out);
  }

  /**
   * Prefer chatSessions over transcripts; collapse Windows case-alias duplicates
   * of the same session id so we never triple-count one Copilot chat.
   */
  static dedupeSessionFiles(files: string[]): string[] {
    type Ranked = { path: string; score: number };
    const byReal = new Map<string, Ranked>();
    const bySession = new Map<string, Ranked>();

    for (const fp of files) {
      const real = realPathSafe(fp);
      const realKey = normalizePathKey(real);
      const score = CopilotUsageReader.sessionFileScore(fp);
      const prevReal = byReal.get(realKey);
      if (!prevReal || score > prevReal.score) {
        byReal.set(realKey, { path: real, score });
      }
    }

    for (const item of byReal.values()) {
      const base = path.basename(item.path).replace(/\.(json|jsonl)$/i, "").toLowerCase();
      const prev = bySession.get(base);
      if (!prev || item.score > prev.score) {
        bySession.set(base, item);
      }
    }

    return [...bySession.values()].map((x) => x.path);
  }

  private static sessionFileScore(fp: string): number {
    const n = fp.replace(/\\/g, "/").toLowerCase();
    if (n.includes("/emptywindowchatsessions/")) {
      return 40;
    }
    if (n.includes("/chatsessions/") && !n.includes("copilot-chat")) {
      return 30;
    }
    if (n.includes("/github.copilot-chat/chatsessions/")) {
      return 20;
    }
    if (n.includes("/transcripts/")) {
      return 10;
    }
    return 5;
  }

  private static collectSessionFilesInDir(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) {
      return;
    }
    try {
      for (const f of fs.readdirSync(dir)) {
        const lower = f.toLowerCase();
        if (lower.endsWith(".json") || lower.endsWith(".jsonl")) {
          out.push(path.join(dir, f));
        }
      }
    } catch {
      /* ignore */
    }
  }

  private scanAll(
    mode: "outputOnly" | "incremental" | "fullApi",
    force = false
  ): {
    total: number;
    seen: SeenState;
    detail: string;
    fingerprint: string;
  } {
    const allFiles: string[] = [];
    for (const userDir of this.userDataDirs) {
      allFiles.push(...CopilotUsageReader.discoverSessionFiles(userDir));
    }
    // Cross-dir dedupe (same session mirrored under Code + Cursor User folders)
    const files = CopilotUsageReader.dedupeSessionFiles(allFiles);
    const fingerprint = `${mode}|${fingerprintFiles(files)}`;

    if (!force && this.cachedScan && this.cachedScan.fingerprint === fingerprint) {
      return this.cachedScan;
    }

    const seen: SeenState = { files: {} };
    let total = 0;
    let withTokens = 0;

    for (const fp of files) {
      try {
        const st = fs.statSync(fp);
        seen.files[fp] = st.size;
        const tokens = this.tokensFromFile(fp, mode);
        total += tokens;
        if (tokens > 0) {
          withTokens++;
        }
      } catch (e) {
        log.warn(`Copilot skip ${fp}: ${String(e)}`);
      }
    }

    const result = {
      total,
      seen,
      detail: `sessionFiles=${files.length} filesWithTokens=${withTokens} dirs=${this.userDataDirs.length}`,
      fingerprint,
    };
    this.cachedScan = result;
    return result;
  }

  private tokensFromFile(fp: string, mode: "outputOnly" | "incremental" | "fullApi"): number {
    const raw = fs.readFileSync(fp, "utf8");
    if (fp.toLowerCase().endsWith(".jsonl")) {
      return this.tokensFromJsonl(raw, mode);
    }
    return this.tokensFromJson(raw, mode);
  }

  private tokensFromJsonl(raw: string, mode: "outputOnly" | "incremental" | "fullApi"): number {
    let total = 0;
    let prevPrompt = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let row: { kind?: string; v?: unknown };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      // VS Code log format: { kind, v } where v is turns array or session object
      const turns = normalizeTurns(row.v ?? row);
      for (const turn of turns) {
        total += billTurn(turn, mode, () => {
          const p = turn.promptTokens ?? 0;
          if (p > 0) {
            if (prevPrompt === 0) {
              prevPrompt = p;
              return p;
            }
            if (p > prevPrompt) {
              const d = p - prevPrompt;
              prevPrompt = p;
              return d;
            }
            prevPrompt = p;
          }
          return 0;
        });
      }
    }
    return total;
  }

  private tokensFromJson(raw: string, mode: "outputOnly" | "incremental" | "fullApi"): number {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return 0;
    }
    const turns = normalizeTurns(data);
    let total = 0;
    let prevPrompt = 0;
    for (const turn of turns) {
      total += billTurn(turn, mode, () => {
        const p = turn.promptTokens ?? 0;
        if (p > 0) {
          if (prevPrompt === 0) {
            prevPrompt = p;
            return p;
          }
          if (p > prevPrompt) {
            const d = p - prevPrompt;
            prevPrompt = p;
            return d;
          }
          prevPrompt = p;
        }
        return 0;
      });
    }
    return total;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

interface TurnTokens {
  promptTokens?: number;
  outputTokens?: number;
  text?: string;
}

function billTurn(
  turn: TurnTokens,
  mode: "outputOnly" | "incremental" | "fullApi",
  incrementalPrompt: () => number
): number {
  const p = turn.promptTokens;
  const o = turn.outputTokens;
  if (p != null || o != null) {
    const out = o ?? 0;
    if (mode === "outputOnly") {
      return out;
    }
    if (mode === "fullApi") {
      return (p ?? 0) + out;
    }
    return out + incrementalPrompt();
  }
  if (turn.text) {
    return estimateTokens(turn.text);
  }
  return 0;
}

function normalizeTurns(v: unknown): TurnTokens[] {
  if (v == null) {
    return [];
  }
  if (Array.isArray(v)) {
    return v.flatMap((item) => normalizeTurns(item));
  }
  if (typeof v !== "object") {
    return [];
  }
  const obj = v as Record<string, unknown>;

  // Session object with requests[]
  if (Array.isArray(obj.requests)) {
    return obj.requests.map(extractTurn);
  }

  // Single turn-like object
  if (obj.message || obj.response || obj.result || obj.metadata) {
    return [extractTurn(obj)];
  }

  // Nested v field
  if (obj.v != null) {
    return normalizeTurns(obj.v);
  }

  return [];
}

function extractTurn(turn: unknown): TurnTokens {
  if (!turn || typeof turn !== "object") {
    return {};
  }
  const t = turn as Record<string, unknown>;
  const result = t.result as Record<string, unknown> | undefined;
  const metadata = (result?.metadata ?? t.metadata) as Record<string, unknown> | undefined;
  const promptTokens = num(metadata?.promptTokens ?? metadata?.inputTokens);
  const outputTokens = num(
    metadata?.outputTokens ?? metadata?.completionTokens ?? metadata?.responseTokens
  );
  const message = t.message as Record<string, unknown> | undefined;
  const textParts: string[] = [];
  if (typeof message?.text === "string") {
    textParts.push(message.text);
  }
  if (typeof t.prompt === "string") {
    textParts.push(t.prompt);
  }
  if (Array.isArray(t.response)) {
    textParts.push(collectText(t.response));
  } else if (typeof t.response === "string") {
    textParts.push(t.response);
  }
  return {
    promptTokens,
    outputTokens,
    text: textParts.join(" ").trim() || undefined,
  };
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function collectText(node: unknown, acc: string[] = []): string {
  if (node == null) {
    return acc.join(" ");
  }
  if (typeof node === "string") {
    acc.push(node);
    return acc.join(" ");
  }
  if (Array.isArray(node)) {
    for (const x of node) {
      collectText(x, acc);
    }
    return acc.join(" ");
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/uri|icon|avatar|^id$|kind|metadata|timestamp|date|username|iconpath/i.test(k)) {
        continue;
      }
      collectText(v, acc);
    }
  }
  return acc.join(" ");
}
