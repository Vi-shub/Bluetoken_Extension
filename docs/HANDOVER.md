# BlueToken — Agent Handover

> Give this file to the next agent so they have full project context without re-deriving it.

**Project path:** `c:\Users\smsha\Desktop\Freshwater_Extension`  
**Package:** `releases/<version>/bluetoken-<version>.vsix` (via `npm run package`)  
**Extension ID / name:** `bluetoken` — display name **BlueToken: AI Water Footprint**  
**Author site:** https://www.shubhamvishwakarma.com  
**Prior chat transcript:** `C:\Users\smsha\.cursor\projects\c-Users-smsha-Desktop-Freshwater-Extension\agent-transcripts\afec22f9-9eb8-48a9-9dec-6955b86a69b6\afec22f9-9eb8-48a9-9dec-6955b86a69b6.jsonl`

---

## 1. What this product is

A VS Code / Cursor / Antigravity extension that converts AI **token usage → freshwater consumption** (data-center cooling), and shows it in:

- Status bar
- Side panel (water glass + session / all-time stats)
- Optional manual quick-track (`Ctrl+Alt+W`)

**Baseline metric (default Scope 1+2):** ~**0.004 mL per token**  
Research sources used: Vanderbilt 2025, Google Cloud Gemini disclosures, OffsetAI, UC Riverside “Making AI Less Thirsty”. Per-model rates live in `src/modelRates.ts`.

---

## 2. What’s been done so far

### Product / UX
- Renamed from early “DropTrail” idea → **BlueToken**
- Status bar + webview side panel
- Session + **all-time** persistence via `ExtensionContext.globalState`
- Marketplace-ish packaging: icon, LICENSE (MIT), README, CHANGELOG, `vsce` VSIX
- Commands: show panel, reset session, reset all-time, log tokens, track text, set model, refresh

### Tracking (evolved over several iterations)
1. Early attempt: monkey-patch `vscode.lm.sendRequest` — **wrong API**, abandoned  
2. `@bluetoken` chat participant + LM `selectChatModels` proxy — works only for public LM API consumers  
3. File-edit watcher (`onDidChangeTextDocument`) — catches AI writing into files; filters undo/redo and clipboard pastes  
4. Manual `Ctrl+Alt+W` — universal fallback for any IDE  
5. **Native DB readers** (current primary path):
   - **Cursor** — read local SQLite for chat bubbles  
   - **Antigravity** — decode Protobuf `gen_metadata` for exact tokens  
   - **Copilot** — parse `chatSessions/*.json`, estimate tokens from text  

### Bugs already found & fixed
| Bug | Cause | Fix |
|---|---|---|
| Extension host timeout | `preLaunchTask` watch + bad module config | `tsconfig` → commonjs; remove preLaunchTask |
| Session showed 34M tokens / 136.92 L as “this session” | Lifetime Cursor history treated as a delta when `lastTotal===0` | Baseline-only import; never dump history into session; one-time repair migration |
| New Cursor chat not detected | Most bubbles have `tokenCount: {0,0}` even with text | Hybrid reader: exact counts OR estimate from `text` (`ceil(len/4)`) |
| Paste-into-file not detected | File watcher disabled when Cursor reader active | Watcher re-enabled; clipboard-identical pastes still ignored |

---

## 3. Architecture (current)

```
activate()
  ├── SessionTracker          // persistence + events
  ├── BlueTokenStatusBar
  ├── BlueTokenPanel          // webview
  ├── CursorUsageReader       // polls Cursor state.vscdb via child process
  ├── AntigravityUsageReader  // polls ~/.gemini/.../conversations/*.db
  ├── CopilotUsageReader      // polls workspaceStorage chatSessions JSON
  └── LMTracker               // file watcher + LM proxy + @bluetoken + Ctrl+Alt+W
```

### How DB reading works (important)
VS Code extension host **cannot** use `node:sqlite` without flags. Solution:

1. Plain JS scripts in `resources/` (`db-reader.js`, `ag-reader.js`)
2. Spawned with **`process.execPath` + `ELECTRON_RUN_AS_NODE=1`** (editor’s own Node 22+)
3. `src/dbRunner.ts` wraps spawn, parses one JSON line from stdout

**Do not** add `better-sqlite3` / `sql.js` unless you have a strong reason — the Electron-as-Node approach already works on Cursor.

### Session vs all-time rules
- **First run / no baseline:** import lifetime total into **all-time only** (`addAllTime`), set baseline, **do not** `record()` into session  
- **Later polls:** only **positive deltas** go into session via `record()`  
- If `imported===true` but `lastTotal===0`, treat as baseline sync — **never** flood session  
- State keys are versioned (e.g. Cursor `.v2`) when accounting method changes  

---

## 4. Methods per IDE (source of truth)

### Cursor — primary automatic path
| Item | Detail |
|---|---|
| DB | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |
| Table | `cursorDiskKV` |
| Keys | `bubbleId:<composerId>:<bubbleId>` |
| Exact fields | `tokenCount.inputTokens`, `tokenCount.outputTokens` |
| Reality check | Only ~444 / ~14k bubbles have non-zero counts; newest often `0` with text present |
| Fallback | If `input+output===0` and `text` exists → `ceil(text.length/4)` added as output |
| Script | `resources/db-reader.js` |
| TS | `src/cursorReader.ts` |
| State keys | `bluetoken.cursor.historyImported.v2`, `bluetoken.cursor.lastTotalTokens.v2` |
| Model id for rates | `cursor-chat` → “Editor chat (blended)” @ 0.004 mL/token Scope 1+2 |

**Verified sample (user machine):** ~34.2M exact tokens historically; hybrid adds ~0.5M estimated from text-only bubbles.

### Antigravity — exact via Protobuf
| Item | Detail |
|---|---|
| Dir | `~/.gemini/antigravity-ide/conversations/` |
| Active | `[conversation-id].db` (SQLite) |
| Archived | `*.pb` (not decoded yet) |
| Table | `gen_metadata` → column `data` (BLOB) |
| Decode path | Field **1** → Field **4** (fallback Field **17** → Field **2**) |
| Field 5 | Input / context tokens for that step |
| Field 3 | Output tokens for that step |
| Field 2 | “Cumulative output” — **non-monotonic, do not trust for totals** |
| Water total | Sum over steps of `(field5 + field3)` (each API call reprocesses context) |
| Script | `resources/ag-reader.js` |
| TS | `src/antigravityReader.ts` |
| Model id | `gemini` |

**Verified:** Python field map from Antigravity itself; JS port matched (~42k output + ~3.78M input on one session).

Note: earlier we looked only at `AppData\Roaming\Antigravity` — **wrong place**. Real chat data is under `~/.gemini/antigravity-ide/`.

### Copilot / VS Code
| Item | Detail |
|---|---|
| Path | `<userData>/User/workspaceStorage/<hash>/chatSessions/*.json` |
| Tokens | **Not stored** — estimate from request/response text |
| TS | `src/copilotReader.ts` |
| First run | Import into all-time; later new turns → session |

### Fallbacks (all IDEs)
| Method | File | Notes |
|---|---|---|
| File-edit watcher | `lmTracker.ts` | Min 40 chars; skip undo/redo; skip clipboard match |
| LM API proxy | `lmTracker.ts` | Wraps `vscode.lm.selectChatModels` → `sendRequest` |
| `@bluetoken` participant | `lmTracker.ts` + `package.json` chatParticipants | |
| Quick-track | `Ctrl+Alt+W` | Selection or clipboard |
| Manual log | Command palette | User types token count |

---

## 5. Key source files

| Path | Role |
|---|---|
| `src/extension.ts` | Activate, wire readers, repair migration |
| `src/sessionTracker.ts` | Entries, session/all-time, `record` / `addAllTime` |
| `src/waterCalculator.ts` | mL calc, format, comparisons, `estimateTokens` |
| `src/modelRates.ts` | Per-model Scope 1 / 1+2 rates |
| `src/cursorReader.ts` | Cursor poller |
| `src/antigravityReader.ts` | Antigravity poller |
| `src/copilotReader.ts` | Copilot poller |
| `src/dbRunner.ts` | Spawn editor Node for readers |
| `src/lmTracker.ts` | Watcher + proxy + shortcuts |
| `src/panel.ts` | Webview UI (glass scales dynamically) |
| `src/statusBar.ts` | Status bar item |
| `resources/db-reader.js` | Cursor SQLite hybrid reader (plain JS) |
| `resources/ag-reader.js` | Antigravity Protobuf decoder (plain JS) |
| `package.json` | Commands, settings, activation |
| `tsconfig.json` | `module: commonjs`, `moduleResolution: node` |

### Settings (`bluetoken.*`)
- `scope` — `scope1` | `scope1and2` (default)
- `units` — auto / ml / drops / teaspoons
- `trackCursorChat` / `trackAntigravityChat` / `trackCopilotChat` (default true)
- `pollIntervalSeconds` — default **20**
- `modelRateOverrides`, `showInStatusBar`, `showComparison`

---

## 6. Build / run / package

```bash
npm install
npm run compile          # tsc → out/
npx vsce package --allow-missing-repository --skip-license
```

Install VSIX in Cursor: Extensions → `...` → Install from VSIX → `bluetoken-0.1.0.vsix`  
Or F5 from the extension project (debug host). After code changes: **reload window** or reinstall VSIX.

**Debug tip:** Command `BlueToken: Refresh Usage From Editor Data` forces an immediate Cursor/Antigravity/Copilot poll and shows a toast with delta or “no new tokens”.

---

## 7. Known limitations / open work

1. **Antigravity archived `.pb` files** — not decoded yet; only active `*.db` sessions  
2. **Cursor tokenCount sparse** — hybrid estimate undercounts full prompt context for zero-count bubbles (text-only ≈ output-ish)  
3. **Windsurf** — not installed on user machine; not researched  
4. **Double-count risk** — chat reader + file watcher if AI applies code without going through clipboard filter; mitigated but not perfect  
5. **Publisher / Marketplace** — `publisher: bluetoken`, repo URL placeholder; not published yet  
6. **README** — updated for auto-tracking; keep in sync if methods change  
7. **Repair flag** — `bluetoken.repairedBulkImport.v1` already set on user’s machine after the 34M-token session bug  

---

## 8. Design decisions (don’t undo casually)

- Prefer **reading local editor DBs** over hoping for public chat APIs (native chat is private)  
- Prefer **editor’s own Node + `node:sqlite`** over native npm SQLite modules (Marketplace / ABI pain)  
- **All-time = lifetime footprint; session = only new usage since baseline**  
- Water for Antigravity sums **input+output per generation step** (honest compute cost; context is re-sent)  
- Privacy: readers are **read-only**, data stays on machine; probes should avoid dumping chat text into logs  

---

## 9. Quick verification recipes

### Cursor hybrid reader
```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe" `
  "c:\Users\smsha\Desktop\Freshwater_Extension\resources\db-reader.js" `
  "$env:APPDATA\Cursor\User\globalStorage\state.vscdb"
```
Expect JSON: `{ ok, inputTokens, outputTokens, bubbles, nonZero, estimatedBubbles }`

### Antigravity reader
```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe" `
  "c:\Users\smsha\Desktop\Freshwater_Extension\resources\ag-reader.js" `
  "$env:USERPROFILE\.gemini\antigravity-ide\conversations"
```

### Sanity UX test
1. Reload extension  
2. Ask chat for a short reply  
3. Wait ≤20s or run Refresh  
4. Expect session delta toast / panel update — **not** a multi-million-token single message  

---

## 10. Suggested next steps for the next agent

1. Confirm with user that Cursor chat deltas appear after reload (post hybrid fix)  
2. Optionally decode Antigravity `.pb` archives for full history  
3. Add OutputChannel logging for silent poll failures  
4. Consider tracking Cursor bubbles by `usageUuid` for finer deltas instead of global sum  
5. Marketplace publish prep (real publisher account, screenshots, privacy statement)  
6. Windsurf path research if user installs it  

---

## 11. One-paragraph summary for the next agent

BlueToken is a VS Code-family extension that estimates freshwater used per AI token (~0.004 mL). Native chat cannot be hooked via public APIs, so it **polls local databases**: Cursor’s `state.vscdb` (exact `tokenCount` when present, else text estimate), Antigravity’s Protobuf `gen_metadata` in `~/.gemini/antigravity-ide/conversations/*.db`, and Copilot `chatSessions` JSON (text estimate). Readers run in a child process via `ELECTRON_RUN_AS_NODE`. Lifetime history goes to **all-time**; only deltas go to **session**. Manual `Ctrl+Alt+W` remains the universal fallback. Latest fix: Cursor often stores `tokenCount=0` — without the text fallback, new chats never appeared.
