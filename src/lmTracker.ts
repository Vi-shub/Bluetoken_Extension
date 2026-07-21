/**
 * BlueToken — Language Model tracker.
 *
 * HONEST CAPTURE MODEL
 * ────────────────────
 * There are two surfaces where AI produces output:
 *
 *   A. AI writing into a FILE:
 *      - Composer "Apply" / open-editor inserts → `onDidChangeTextDocument`
 *      - Cursor Agent Write/StrReplace tools → disk writes (often NO text-doc
 *        event). Captured via workspace FileSystemWatcher while AI is active.
 *
 *   B. AI answering only in a CHAT BUBBLE (a Q&A that never touches a file).
 *      Native chat panels in Cursor, Antigravity, and Copilot all use private
 *      backends that extensions cannot observe. These need the quick-track
 *      shortcut (select the reply + Ctrl+Alt+W).
 *
 * Layers implemented here:
 *   1. File-edit watchers     — text-doc + disk (Cursor/AG). Filters pastes.
 *   2. selectChatModels proxy — automatic for the (rare) extensions that use
 *                               the public LM API. Written defensively so it
 *                               can never break another extension.
 *   3. @bluetoken participant — forwards a prompt to the LM and tracks it.
 *   4. Quick-track command    — universal manual capture (any IDE, any tool).
 *   5. Manual log command     — type a token count by hand.
 */

import * as vscode from "vscode";
import { SessionTracker } from "./sessionTracker";
import {
  calculateWater,
  getScopeConfig,
  getModelOverrides,
  estimateTokens,
} from "./waterCalculator";
import { listModelPickChoices } from "./modelRates";
import { log } from "./log";
import { detectHost, hostDisplayName } from "./host";
import { aiActiveRecently, diskFileEditsSuppressed, markAiActivity } from "./aiActivity";

/**
 * AI / Composer / Agent inserts are usually bigger than a keystroke.
 * Multi-line inserts with fewer chars still count (common for short AI patches).
 * Cursor Agent often lands many small chunks in one event — we also sum those.
 */
const FILE_EDIT_MIN_CHARS = 16;
const FILE_EDIT_MIN_MULTILINE = 6;
const FILE_EDIT_BATCH_MIN = 12;
const LAST_MODEL_KEY = "bluetoken.lastModel";
/** Coalesce rapid Composer/agent chunks into one session row. */
const FILE_EDIT_COALESCE_MS = 700;
/** Disk writes within this window after chat activity count as agent edits. */
const DISK_AI_WINDOW_MS = 180_000;
const DISK_MIN_GROWTH = 12;

const DISK_IGNORE =
  /[\\/](node_modules|\.git|\.cursor|out|dist|build|releases|\.vsix|__pycache__|\.next)[\\/]/i;

export class LMTracker {
  private lastAutoTrackMs = 0;
  private context!: vscode.ExtensionContext;
  private pendingFileChars = 0;
  private fileFlushTimer: NodeJS.Timeout | undefined;
  /** Last known on-disk size per fsPath (for agent Write/StrReplace). */
  private diskSizes = new Map<string, number>();
  /** Paths recently counted via TextDocument — avoid double-billing disk. */
  private recentDocPaths = new Map<string, number>();

  constructor(private readonly session: SessionTracker) {}

  activate(context: vscode.ExtensionContext, options: { fileWatcher?: boolean } = {}): void {
    this.context = context;
    const enableFileWatcher = options.fileWatcher ?? true;

    context.subscriptions.push(
      vscode.commands.registerCommand("bluetoken.logTokens", () =>
        this.promptManualLog()
      ),
      vscode.commands.registerCommand("bluetoken.trackText", () =>
        this.quickTrack()
      ),
      vscode.commands.registerCommand("bluetoken.setModel", () =>
        this.pickAndRememberModel(true)
      ),
      {
        dispose: () => {
          if (this.fileFlushTimer) {
            clearTimeout(this.fileFlushTimer);
            this.flushPendingFileEdits();
          }
        },
      }
    );

    setImmediate(() => {
      // Chat DB readers do NOT count Composer/agent writes into files.
      // Keep the file watcher on in every IDE (including Cursor).
      if (enableFileWatcher) {
        this.registerFileEditWatcher(context);
        const host = detectHost();
        if (host === "cursor" || host === "antigravity") {
          this.registerDiskEditWatcher(context);
          log.info(`File-edit watcher on (${hostDisplayName()}, text+disk)`);
        } else {
          log.info(`File-edit watcher on (${hostDisplayName()})`);
        }
      }
      this.patchSelectChatModels(context);
      this.registerChatParticipant(context);
    });
  }

  // ── Layer 1a: open-editor Apply / Composer inserts ─────────────────────────

  private registerFileEditWatcher(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.onDidChangeTextDocument((event) => {
      const scheme = event.document.uri.scheme;
      // Cursor/agent sometimes touch vscode-userdata / output; only count real docs.
      if (scheme !== "file" && scheme !== "untitled") {
        return;
      }

      if (
        event.reason === vscode.TextDocumentChangeReason.Undo ||
        event.reason === vscode.TextDocumentChangeReason.Redo
      ) {
        return;
      }

      // Avoid double-counting with the LM proxy / participant.
      if (Date.now() - this.lastAutoTrackMs < 1200) {
        return;
      }

      let added = 0;
      let totalInserted = 0;
      for (const c of event.contentChanges) {
        const len = c.text?.length ?? 0;
        totalInserted += len;
        // Whole-range replace (common for Apply): count inserted text.
        if (len > 0 && (c.rangeLength ?? 0) > 0 && len >= FILE_EDIT_MIN_MULTILINE) {
          added += len;
          continue;
        }
        if (this.looksLikeAiInsertion(c.text)) {
          added += len;
        }
      }

      // Agent/Composer often applies many small chunks in one event.
      if (added <= 0 && totalInserted >= FILE_EDIT_BATCH_MIN && event.contentChanges.length >= 2) {
        added = totalInserted;
      }
      // Large single replace (whole-file / big Apply).
      if (added <= 0 && totalInserted >= 48) {
        added = totalInserted;
      }

      if (added <= 0) {
        return;
      }

      markAiActivity();
      const fsPath = event.document.uri.scheme === "file" ? event.document.uri.fsPath : undefined;
      if (fsPath) {
        this.recentDocPaths.set(fsPath, Date.now());
        this.diskSizes.set(fsPath, Buffer.byteLength(event.document.getText(), "utf8"));
      }
      const sample = event.contentChanges.map((c) => c.text).join("");
      void this.considerFileInsertion(added, sample, fsPath, "doc");
    });

    context.subscriptions.push(watcher);
  }

  /**
   * Cursor Agent Write/StrReplace write to disk; they often never fire
   * onDidChangeTextDocument for third-party extensions. Catch those here
   * while chat/agent activity was recently seen.
   */
  private registerDiskEditWatcher(context: vscode.ExtensionContext): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      log.warn("Disk file-edit watcher: no workspace folder open");
      return;
    }

    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, "**/*");
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onUri = (uri: vscode.Uri, kind: "change" | "create") => {
        void this.considerDiskEdit(uri, kind);
      };
      watcher.onDidChange((uri) => onUri(uri, "change"));
      watcher.onDidCreate((uri) => onUri(uri, "create"));
      context.subscriptions.push(watcher);
    }
    log.debug(`Disk file-edit watcher on ${folders.length} folder(s)`);
    // Snapshot sizes now so the first Agent Write is a delta, not a missed baseline.
    void this.baselineWorkspaceSizes();
  }

  private async baselineWorkspaceSizes(): Promise<void> {
    try {
      const uris = await vscode.workspace.findFiles(
        "**/*",
        "{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/releases/**,**/.cursor/**}",
        3000
      );
      let n = 0;
      for (const uri of uris) {
        if (DISK_IGNORE.test(uri.fsPath)) {
          continue;
        }
        try {
          const st = await vscode.workspace.fs.stat(uri);
          if (!this.diskSizes.has(uri.fsPath)) {
            this.diskSizes.set(uri.fsPath, st.size);
            n++;
          }
        } catch {
          /* ignore */
        }
      }
      log.debug(`Disk size baseline: ${n} files`);
    } catch (e) {
      log.warn(`Disk size baseline failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async considerDiskEdit(uri: vscode.Uri, kind: "change" | "create"): Promise<void> {
    if (uri.scheme !== "file") {
      return;
    }
    const fsPath = uri.fsPath;
    if (DISK_IGNORE.test(fsPath)) {
      return;
    }
    // Human typing saves happen without recent AI; agent tools write during AI window.
    if (!aiActiveRecently(DISK_AI_WINDOW_MS)) {
      // Still baseline sizes so the next AI write has a delta.
      try {
        const st = await vscode.workspace.fs.stat(uri);
        this.diskSizes.set(fsPath, st.size);
      } catch {
        /* missing */
      }
      return;
    }

    // Cursor DB already billed this apply via codeBlockDiff / toolFormerData.
    if (diskFileEditsSuppressed()) {
      try {
        const st = await vscode.workspace.fs.stat(uri);
        this.diskSizes.set(fsPath, st.size);
      } catch {
        /* missing */
      }
      return;
    }

    // Already counted via TextDocument for this path.
    const docAt = this.recentDocPaths.get(fsPath) ?? 0;
    if (Date.now() - docAt < 2500) {
      return;
    }

    let size = 0;
    try {
      const st = await vscode.workspace.fs.stat(uri);
      size = st.size;
    } catch {
      return;
    }

    const prev = this.diskSizes.get(fsPath);
    this.diskSizes.set(fsPath, size);

    let chars = 0;
    if (prev === undefined) {
      // First observation: baseline only (unless a brand-new file was created).
      if (kind === "create") {
        chars = Math.min(size, 200_000);
      } else {
        return;
      }
    } else if (size > prev) {
      chars = size - prev;
    } else if (size < prev) {
      // Shrink / rewrite — count magnitude of change (StrReplace often shrinks).
      chars = Math.min(prev - size, 100_000);
    } else {
      // Same byte size: ignore (avoids noisy re-saves). Equal-length StrReplace
      // is rare; chat bubbles still capture the tool text estimate.
      return;
    }

    if (chars < DISK_MIN_GROWTH) {
      return;
    }

    void this.considerFileInsertion(chars, "", fsPath, "disk");
  }

  private looksLikeAiInsertion(text: string): boolean {
    if (!text) {
      return false;
    }
    if (text.length >= FILE_EDIT_MIN_CHARS) {
      return true;
    }
    // Short multi-line patches (Composer often lands these).
    if (text.includes("\n") && text.trim().length >= FILE_EDIT_MIN_MULTILINE) {
      return true;
    }
    return false;
  }

  private async considerFileInsertion(
    charCount: number,
    sampleText: string,
    filePath?: string,
    via: "doc" | "disk" = "doc"
  ): Promise<void> {
    // Exact clipboard match → human paste (only when paste is sizable).
    if (sampleText.trim().length >= FILE_EDIT_MIN_CHARS) {
      try {
        const clipboard = (await vscode.env.clipboard.readText()).trim();
        if (clipboard && sampleText.trim() === clipboard) {
          log.debug(`File-edit skipped (clipboard paste) ~${charCount} chars`);
          return;
        }
      } catch {
        /* clipboard unavailable */
      }
    }

    this.pendingFileChars += charCount;
    if (filePath) {
      log.debug(
        `File-edit pending +${charCount} chars via=${via} in ${filePath.split(/[/\\]/).pop()}`
      );
    } else {
      log.debug(`File-edit pending +${charCount} chars via=${via}`);
    }
    if (this.fileFlushTimer) {
      clearTimeout(this.fileFlushTimer);
    }
    this.fileFlushTimer = setTimeout(() => this.flushPendingFileEdits(), FILE_EDIT_COALESCE_MS);
  }

  private flushPendingFileEdits(): void {
    this.fileFlushTimer = undefined;
    const chars = this.pendingFileChars;
    this.pendingFileChars = 0;
    if (chars < FILE_EDIT_MIN_MULTILINE) {
      return;
    }

    const tokens = Math.max(1, Math.ceil(chars / 4));
    const host = detectHost();
    const model =
      host === "cursor" ? "cursor-agent" : host === "antigravity" ? "gemini" : this.getSavedModel();
    const result = calculateWater(tokens, model, getScopeConfig(), getModelOverrides());
    const source =
      host === "cursor"
        ? "Cursor AI edit in file"
        : host === "antigravity"
          ? "Antigravity AI edit in file"
          : "VS Code AI edit in file";
    this.session.record(result, source);
    log.info(`${source}: +${tokens} tokens (~${chars} chars)`);
  }

  // ── Layer 2: safe proxy of vscode.lm.selectChatModels ─────────────────────

  private patchSelectChatModels(context: vscode.ExtensionContext): void {
    if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
      return;
    }

    const original = vscode.lm.selectChatModels.bind(vscode.lm);
    const self = this;

    (vscode.lm as any).selectChatModels = async function (
      selector?: vscode.LanguageModelChatSelector
    ): Promise<vscode.LanguageModelChat[]> {
      const models = await original(selector);
      try {
        return models.map((m) => self.wrapModel(m));
      } catch {
        // Never let our wrapping break the caller — return originals.
        return models;
      }
    };

    context.subscriptions.push({
      dispose: () => {
        (vscode.lm as any).selectChatModels = original;
      },
    });
  }

  /** Wrap a model so `sendRequest` transparently counts tokens. Fully safe: any
   *  failure falls back to the real behavior. */
  private wrapModel(model: vscode.LanguageModelChat): vscode.LanguageModelChat {
    const self = this;
    return new Proxy(model, {
      get(target, prop, receiver) {
        if (prop !== "sendRequest") {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" ? v.bind(target) : v;
        }
        return async function (
          messages: vscode.LanguageModelChatMessage[],
          options?: vscode.LanguageModelChatRequestOptions,
          token?: vscode.CancellationToken
        ): Promise<vscode.LanguageModelChatResponse> {
          const response = await target.sendRequest(messages, options, token);
          try {
            const inputTokens = self.countMessageTokens(messages);
            return self.wrapResponse(response, target, inputTokens);
          } catch {
            return response; // never break the consumer
          }
        };
      },
    });
  }

  /** Proxy the response so consuming `.text` or `.stream` also feeds our counter.
   *  Preserves the original object's prototype and every other member. */
  private wrapResponse(
    response: vscode.LanguageModelChatResponse,
    model: vscode.LanguageModelChat,
    inputTokens: number
  ): vscode.LanguageModelChatResponse {
    const self = this;
    let recorded = false;

    const record = (outputText: string) => {
      if (recorded || outputText.length === 0) {
        return;
      }
      recorded = true;
      const totalTokens = inputTokens + estimateTokens(outputText);
      const modelId = model.id ?? model.name ?? "unknown";
      const result = calculateWater(
        totalTokens,
        modelId,
        getScopeConfig(),
        getModelOverrides()
      );
      self.lastAutoTrackMs = Date.now();
      self.session.record(result, `${model.name} (auto)`);
    };

    return new Proxy(response, {
      get(target, prop, receiver) {
        if (prop === "text") {
          return self.tapTextStream(target.text, record);
        }
        if (prop === "stream") {
          return self.tapPartStream((target as any).stream, record);
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }

  private async *tapTextStream(
    source: AsyncIterable<string>,
    onDone: (text: string) => void
  ): AsyncIterable<string> {
    let acc = "";
    try {
      for await (const chunk of source) {
        acc += chunk;
        yield chunk;
      }
    } finally {
      onDone(acc);
    }
  }

  private async *tapPartStream(
    source: AsyncIterable<any>,
    onDone: (text: string) => void
  ): AsyncIterable<any> {
    let acc = "";
    try {
      for await (const part of source) {
        const value =
          typeof part === "string" ? part : part?.value ?? "";
        if (typeof value === "string") {
          acc += value;
        }
        yield part;
      }
    } finally {
      onDone(acc);
    }
  }

  private countMessageTokens(messages: vscode.LanguageModelChatMessage[]): number {
    return messages.reduce((sum, m) => {
      const parts = Array.isArray(m.content) ? m.content : [m.content];
      const text = parts
        .map((p: any) =>
          typeof p === "string" ? p : p?.value ?? p?.toString?.() ?? ""
        )
        .join("");
      return sum + estimateTokens(text);
    }, 0);
  }

  // ── Layer 3: @bluetoken chat participant ──────────────────────────────────

  private registerChatParticipant(context: vscode.ExtensionContext): void {
    if (!("chat" in vscode)) {
      return;
    }
    try {
      const participant = (vscode as any).chat.createChatParticipant(
        "bluetoken.assistant",
        (request: any, _ctx: any, stream: any, token: vscode.CancellationToken) =>
          this.chatHandler(request, stream, token)
      );
      if (participant) {
        participant.iconPath = new vscode.ThemeIcon("drop");
        context.subscriptions.push(participant);
      }
    } catch {
      /* chat API unavailable */
    }
  }

  private async chatHandler(
    request: any,
    stream: any,
    cancelToken: vscode.CancellationToken
  ): Promise<void> {
    const userPrompt: string = request.prompt ?? "";
    const inputTokens = estimateTokens(userPrompt);

    let models: vscode.LanguageModelChat[] = [];
    try {
      models = await vscode.lm.selectChatModels({});
    } catch {
      /* none */
    }
    if (!models.length) {
      stream.markdown(
        "**BlueToken**: No language model available via the VSCode API. " +
          "Use the quick-track shortcut instead: select the reply and press Ctrl+Alt+W."
      );
      return;
    }

    const model = models[0];
    const messages = [vscode.LanguageModelChatMessage.User(userPrompt)];
    let outputText = "";
    try {
      const response = await model.sendRequest(messages, {}, cancelToken);
      for await (const chunk of response.text) {
        outputText += chunk;
        stream.markdown(chunk);
      }
    } catch (err: unknown) {
      stream.markdown(`\n\n**Error:** ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // The proxy already recorded this via sendRequest, so don't double-count;
    // just append the footer using a fresh calculation for display.
    const totalTokens = inputTokens + estimateTokens(outputText);
    const result = calculateWater(totalTokens, model.id, getScopeConfig(), getModelOverrides());
    stream.markdown(
      `\n\n---\n*BlueToken: **${result.formattedAmount}** freshwater · ${totalTokens.toLocaleString()} tokens*`
    );
  }

  // ── Layer 4: universal quick-track ────────────────────────────────────────

  private async quickTrack(): Promise<void> {
    let text = "";
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      text = editor.document.getText(editor.selection);
    } else {
      text = await vscode.env.clipboard.readText();
    }

    text = text.trim();
    if (!text) {
      vscode.window.showWarningMessage(
        "BlueToken: Nothing to track. Select the AI's reply (or copy it), then press Ctrl+Alt+W."
      );
      return;
    }

    const model = await this.getRememberedModel();
    const tokens = estimateTokens(text);
    const result = calculateWater(tokens, model, getScopeConfig(), getModelOverrides());
    this.session.record(result, `Quick-track (${result.modelRate.displayName})`);

    vscode.window.showInformationMessage(
      `BlueToken: +${result.formattedAmount} | ${tokens.toLocaleString()} tokens (${result.modelRate.displayName}).`
    );
  }

  // ── Layer 5: manual log ────────────────────────────────────────────────────

  private async promptManualLog(): Promise<void> {
    const model = await this.getRememberedModel();
    const tokenInput = await vscode.window.showInputBox({
      prompt: `Total tokens used on ${model} (input + output combined)`,
      placeHolder: "e.g. 500",
      validateInput: (v) =>
        isNaN(Number(v)) || Number(v) <= 0 ? "Enter a positive number" : null,
    });
    if (!tokenInput) {
      return;
    }
    const tokens = parseInt(tokenInput, 10);
    const result = calculateWater(tokens, model, getScopeConfig(), getModelOverrides());
    this.session.record(result, "Manual log");
    vscode.window.showInformationMessage(
      `BlueToken: +${result.formattedAmount} | ${tokens.toLocaleString()} tokens on ${result.modelRate.displayName}.`
    );
  }

  // ── Model memory ────────────────────────────────────────────────────────────

  private getSavedModel(): string {
    return this.context.globalState.get<string>(LAST_MODEL_KEY) ?? "unknown";
  }

  private async getRememberedModel(): Promise<string> {
    const saved = this.context.globalState.get<string>(LAST_MODEL_KEY);
    return saved ?? this.pickAndRememberModel(false);
  }

  private async pickAndRememberModel(announce: boolean): Promise<string> {
    const choices = listModelPickChoices();
    const pick = await vscode.window.showQuickPick(choices, {
      placeHolder: "Which model are you using? (BlueToken remembers this)",
    });
    const model = pick ?? "gpt-4o";
    await this.context.globalState.update(LAST_MODEL_KEY, model);
    if (announce) {
      vscode.window.showInformationMessage(`BlueToken: model set to "${model}".`);
      log.info(`Model set to ${model}`);
    }
    return model;
  }
}
