# Contributing to BlueToken

Thanks for helping make AI water use visible.

## Dev setup

```bash
npm install
npm run compile
# F5 in VS Code / Cursor to launch the Extension Development Host
```

Package a versioned VSIX:

```bash
npm run package
# → releases/<version>/bluetoken-<version>.vsix
```

## Project map

| Path | Role |
|---|---|
| `src/extension.ts` | Activation, commands, wiring |
| `src/*Reader.ts` | Cursor / Antigravity / Copilot pollers |
| `resources/*-reader.js` | SQLite readers (spawned via Electron-as-Node) |
| `src/sessionTracker.ts` | Session + all-time persistence |
| `src/panel.ts` / `statusBar.ts` | UI |
| `src/links.ts` | Author site, GitHub, research paper URLs |
| `docs/HANDOVER.md` | Deep technical context for maintainers / agents |
| `releases/` | Versioned `.vsix` output |
| `media/` | Screenshots for README / Marketplace |

## Guidelines

- Keep readers **read-only** on editor databases
- Prefer exact token fields when present; document estimate fallbacks
- Don’t log chat text to OutputChannel / console in production paths
- Don’t break session vs all-time baseline rules (lifetime → all-time; deltas → session)
- Update `CHANGELOG.md` for user-facing changes

## Pull requests

1. Fork + branch
2. `npm run compile` must pass
3. Short description of what / why
4. Note which IDEs you tested (Cursor / Antigravity / VS Code Copilot)

## Code of conduct

Be respectful. This project is about awareness, not shaming people for using AI. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
