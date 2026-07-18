# Publish & open-source checklist

Homepage / author site: https://www.shubhamvishwakarma.com

## A. Open source on GitHub

1. Create a public repo (recommended name: `bluetoken`).
2. Update these to your real GitHub username/repo:
   - `package.json` → `repository`, `bugs`
   - `src/links.ts` → `github`, `repository`
3. In the project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial open-source release of BlueToken"
   git remote add origin https://github.com/YOUR_USER/bluetoken.git
   git branch -M main
   git push -u origin main
   ```
4. Add topics: `vscode-extension`, `sustainability`, `ai`, `copilot`, `cursor`, `water`.
5. Create a GitHub Release `v0.1.4` and attach `releases/0.1.4/bluetoken-0.1.4.vsix`
   (build with `npm run package` if the binary is not present).

## B. VS Code Marketplace

1. Create a publisher: https://marketplace.visualstudio.com/manage  
   (Azure DevOps org + Personal Access Token with Marketplace scope)
2. Set `"publisher"` in `package.json` to that exact publisher ID.
3. Login + publish:
   ```bash
   npx vsce login YOUR_PUBLISHER
   npm run package
   npx vsce publish
   ```
4. Marketplace listing tips:
   - Clear README (root)
   - Link PRIVACY.md
   - 1–2 screenshots in `media/`
   - Categories already set: Visualization / Other

## C. Open VSX (Cursor / other forks often use this too)

```bash
npm run package
npx ovsx publish releases/<version>/bluetoken-<version>.vsix -p YOUR_OPENVSX_TOKEN
```

https://open-vsx.org/

## D. Before you hit publish — quick QA

- [ ] Cursor: chat → session increases; timestamp looks right
- [ ] Antigravity: chat → Gemini row with real clock time
- [ ] VS Code Copilot: chat → Copilot row appears after Refresh
- [ ] `Ctrl+Alt+W` works
- [ ] Reset session / reset all-time work
- [ ] No chat text in logs
- [ ] Icon 128×128+ PNG present (`resources/icon.png`)
