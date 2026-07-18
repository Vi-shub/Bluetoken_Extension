# BlueToken: AI Water Footprint

> See the freshwater your AI assistant actually costs, right inside your editor.

Every AI response heats data-center servers. Cooling them uses real freshwater. BlueToken turns that invisible cost into a number you can see in **Cursor, GitHub Copilot, Antigravity, and any VS Code-based editor**.

**Open source · MIT · 100% local.** Chat data never leaves your machine.

**Author:** [Shubham Vishwakarma](https://www.shubhamvishwakarma.com) · [★ Star on GitHub](https://github.com/Vi-shub/Bluetoken_Extension)

---

## Automatic tracking

| Tool | How | Accuracy |
|---|---|---|
| **Cursor chat** | Local `state.vscdb` (`tokenCount`, text fallback) | Exact / estimated hybrid |
| **Antigravity chat** | Protobuf `gen_metadata` in `~/.gemini/.../conversations/*.db` | Exact (real step timestamps) |
| **GitHub Copilot chat** | `emptyWindowChatSessions` / `chatSessions` (`.jsonl`) | Exact when metadata present |
| AI edits into files | Document watcher | Estimated |
| Anything else | `Ctrl+Alt+W` on selection/clipboard | Estimated |

---

## Install

### From a VSIX release

```bash
npm install
npm run package
```

Then: **Extensions → ⋯ → Install from VSIX…** → `releases/<version>/bluetoken-<version>.vsix`

Prebuilt copies (when present locally) live under [`releases/`](releases/).

### From source ( Extension Development Host )

```bash
npm install
npm run compile
# Press F5 in VS Code / Cursor
```

---

## Repository layout

```
bluetoken/
├── src/                 # TypeScript extension source
├── resources/           # Icon + SQLite reader scripts (plain JS)
├── media/               # Screenshots / GIFs for README & Marketplace
├── releases/            # Versioned .vsix builds (see releases/README.md)
│   └── 0.1.4/bluetoken-0.1.4.vsix
├── docs/                # Maintainer docs (publish checklist, agent handover)
├── scripts/             # Build helpers (package VSIX into releases/)
├── .github/             # Issue / PR templates
├── package.json         # Extension manifest
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── PRIVACY.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
└── LICENSE
```

---

## What you see

- **Status bar** — live session water total
- **Side panel** — water glass, session + all-time stats, research & author links
- **Persistent** — totals survive restarts

---

## The metric

Default **Scope 1+2 ≈ 0.004 mL / token** (cooling + electricity-generation water).

Research (also in the panel via **BlueToken: Open Research Papers**):

- [Making AI Less Thirsty (arXiv)](https://arxiv.org/abs/2304.03271) — UC Riverside
- [ACM version](https://doi.org/10.1145/3724499)
- [UCR News](https://news.ucr.edu/articles/2023/04/28/ai-programs-consume-large-volumes-scarce-water)

Also referenced for rates: Vanderbilt (2025), Google Cloud Gemini disclosures, OffsetAI. Per-model rates live in settings / `src/modelRates.ts`.

---

## Privacy

BlueToken only **reads** local editor databases on your disk. Nothing is uploaded. See [PRIVACY.md](PRIVACY.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Before opening a PR: `npm run compile` must pass. Note which IDEs you tested.

---

## Publish / Marketplace

Maintainer checklist: [docs/PUBLISH.md](docs/PUBLISH.md).

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Shubham Vishwakarma](https://www.shubhamvishwakarma.com).
