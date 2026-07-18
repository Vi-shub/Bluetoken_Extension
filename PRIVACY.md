# Privacy

BlueToken is designed to keep your AI chat data **on your machine**.

## What we read (locally only)

Depending on which editors you use, BlueToken may **read** (never write to):

- Cursor: `%APPDATA%/Cursor/User/globalStorage/state.vscdb` (chat bubble token fields / text lengths)
- Antigravity: `~/.gemini/antigravity-ide/conversations/*.db` (token fields in `gen_metadata`, step timestamps)
- VS Code / Copilot: `User/globalStorage/emptyWindowChatSessions/*.jsonl` and legacy `workspaceStorage/*/chatSessions/*.json`

Token totals and water estimates are stored in VS Code/Cursor **extension globalState** on your device.

## What we do not do

- No network calls to BlueToken servers (there are none)
- No uploading of chat text, code, or prompts
- No analytics / telemetry from this extension

## Uninstall

Removing the extension stops all readers. Extension state may remain in the editor’s global storage until cleared by the editor.

## Contact

Open an issue on the GitHub repository listed in `package.json`.
