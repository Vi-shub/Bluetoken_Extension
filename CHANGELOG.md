# Changelog

All notable changes to the BlueToken extension are documented here.

## [0.1.8] - 2026-07-20

### Fixed
- **Cursor file edits not capturing**: removed the 8s post-chat suppress that dropped Composer/Agent Applies (and pending coalesced edits).
- File-edit watcher now counts multi-chunk agent batches and large single replaces; lower thresholds; debug logs for pending/skipped edits.

## [0.1.7] - 2026-07-19

### Fixed
- Host isolation no longer wipes all-time totals (was rebuilding from the rolling session window).
- Bulk-import repair now clears the correct versioned reader keys (`.v2` / `.v3` / `.v4`).
- Cursor DB counts only `bubbleId` bubbles (file Apply is tracked separately by the file watcher).
- Poll clamps no longer force secondary (other-IDE) readers to 3s.
- Copilot busy/refresh race could record the same delta twice.
- Migrations finish before readers start (avoids race on activate).
- Count-mode switches re-baseline instead of flooding the session with a huge jump.

## [0.1.6] - 2026-07-18

### Fixed
- **Live Cursor updates**: fingerprint now includes SQLite `-wal`/`-shm` (old builds skipped polls until checkpoint, so only manual refresh showed new tokens).
- **fs.watch** on Cursor/Antigravity DB folders — updates within ~250ms, plus a 3s backup poll (old 20s settings are capped).
- **Cursor file writes**: Composer/agent edits into files are tracked again (chat DB alone never counted Apply/agent patches).

### Improved
- Cursor DB reader estimates from richer bubble text/code fields when `tokenCount` is 0.

## [0.1.5] - 2026-07-18

### Fixed
- **Per-IDE isolation**: VS Code / Cursor / Antigravity no longer import each other's chat into one total. Each editor tracks only its own chat by default.
- **Faster auto-updates**: default poll interval is 5s (was 20s); first poll starts within ~1s so manual refresh is rarely needed.
- One-time cleanup removes foreign IDE rows that older builds mixed into the session.

### Added
- Setting `bluetoken.trackOtherIdes` (default off) if you explicitly want combined cross-editor tracking.
- Expanded model rates for Cursor (Composer, Agent), Copilot/VS Code Chat, and Antigravity Gemini (2.5 Pro/Flash/Flash-Lite, 2.0).
- Marketplace description links to GitHub and [shubhamvishwakarma.com](https://www.shubhamvishwakarma.com).

## [0.1.4] - 2026-07-16

### Improved
- **Efficiency**: skip Cursor/Antigravity DB spawns and Copilot file parses when disk fingerprints are unchanged; overlap guards; staggered polls; no auto-diagnose on every activate.
- **Robustness**: de-dupe Copilot session files (Windows case aliases + chatSessions vs transcripts) so one chat is not triple-counted.
- **Copy**: removed long em-dashes from display name, Marketplace description, and toasts.
- **Links**: research papers in panel/status bar; author site [shubhamvishwakarma.com](https://www.shubhamvishwakarma.com).
- **Repo layout**: `docs/`, `releases/<version>/`, `media/`, `.github/` templates; `npm run package` writes versioned VSIX.

## [0.1.2] - 2026-07-15

### Fixed / improved
- **Diagnostics**: `BlueToken: Diagnose` + Output channel `BlueToken` for debugging other machines.
- Hardened Cursor / Antigravity / Copilot path discovery; readers always start and retry.
- Copilot scans VS Code + Cursor + Insiders user folders; clearer errors when `node:sqlite` spawn fails.
- Expanded model rate list (GPT-5, Claude 4, Gemini 2.5, Composer, DeepSeek, Grok, Qwen, …).

## [0.1.1] — 2026-07-14

### Fixed
- Antigravity entries now use **real step timestamps** from the DB (not poll/wake time).
- Copilot reader looks at modern `emptyWindowChatSessions/*.jsonl` with exact `outputTokens`.
- Antigravity default count mode `outputOnly` (ignore huge context dumps).
- Lifetime history no longer dumped into the live session as one giant message.

### Docs
- Privacy policy, contributing guide, publish checklist for open source + Marketplace.

## [0.1.0] — 2026-07-10

### Added
- Exact Cursor tracking from `state.vscdb`.
- Exact Antigravity tracking from Protobuf `gen_metadata`.
- Copilot / file-watcher / `Ctrl+Alt+W` fallbacks.
- Status bar + side panel; session + all-time persistence.
- Per-model water rates; Scope 1 / Scope 1+2.
