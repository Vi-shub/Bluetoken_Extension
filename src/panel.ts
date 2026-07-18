import * as vscode from "vscode";
import { SessionTracker, SessionStats } from "./sessionTracker";
import { formatWater, toComparison } from "./waterCalculator";
import { LINKS, isPlaceholderUrl } from "./links";

export class BlueTokenPanel implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly tracker: SessionTracker
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Immediately render current (possibly persisted) stats — never show 0 if data exists.
    const current = this.tracker.getStats();
    webviewView.webview.html = this.buildHtml(current);

    webviewView.webview.onDidReceiveMessage((msg: { command: string; url?: string }) => {
      if (msg.command === "resetSession") {
        vscode.commands.executeCommand("bluetoken.resetSession");
      }
      if (msg.command === "resetAllTime") {
        vscode.commands.executeCommand("bluetoken.resetAllTime");
      }
      if (msg.command === "logTokens") {
        vscode.commands.executeCommand("bluetoken.logTokens");
      }
      if (msg.command === "openExternal" && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
      if (msg.command === "openGithub") {
        vscode.commands.executeCommand("bluetoken.openGithub");
      }
      if (msg.command === "openProject") {
        vscode.commands.executeCommand("bluetoken.openProject");
      }
      if (msg.command === "openResearch") {
        vscode.commands.executeCommand("bluetoken.openResearch");
      }
    });
  }

  /** Push a stats update to the webview (called by the onDidUpdate subscription). */
  push(stats: SessionStats): void {
    if (this.view) {
      this.view.webview.html = this.buildHtml(stats);
    }
  }

  private buildHtml(stats: SessionStats): string {
    const { totalMl, totalTokens, messageCount, entries, sessionStartMs, allTimeMl, allTimeTokens } = stats;

    // Scale the glass to a sensible capacity for the current session size.
    const glassCapMl =
      totalMl <= 250 ? 250 : totalMl <= 1000 ? 1000 : totalMl <= 5000 ? 5000 : Math.ceil(totalMl / 1000) * 1000;
    const fillPercent = Math.min(100, totalMl <= 0 ? 0 : (totalMl / glassCapMl) * 100);
    const glassCapLabel = glassCapMl >= 1000 ? `${(glassCapMl / 1000).toFixed(glassCapMl % 1000 === 0 ? 0 : 1)} L` : `${glassCapMl} mL`;
    const sessionLabel = formatWater(totalMl);
    const comparison = totalMl > 0 ? toComparison(totalMl) : null;
    const sessionDurationMin = Math.round((Date.now() - sessionStartMs) / 60_000);
    const recentEntries = entries.slice(-8).reverse();

    const waterColor =
      totalMl >= 200_000 ? "#d94040" : totalMl >= 50_000 ? "#d97c20" : totalMl >= 200 ? "#d97c20" : "#2196f3";

    const rows = recentEntries
      .map(
        (e) => `
      <tr>
        <td class="td-model" title="${escHtml(e.source)}">${escHtml(e.modelDisplayName)}</td>
        <td class="td-water" style="color:${waterColor}">${formatWater(e.mlUsed)}</td>
        <td class="td-tokens">${e.tokens.toLocaleString()}tk</td>
        <td class="td-time">${new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
      </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>BlueToken</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, transparent);
    padding: 14px 12px 20px;
    line-height: 1.5;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .header-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .header-badge {
    font-size: 10px;
    background: var(--vscode-badge-background, #0e639c);
    color: var(--vscode-badge-foreground, #fff);
    border-radius: 10px;
    padding: 1px 7px;
  }

  /* ── Glass + main stat ── */
  .hero {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    margin-bottom: 10px;
  }
  .glass-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
  .glass {
    width: 44px;
    height: 72px;
    border: 2px solid var(--vscode-widget-border, #454545);
    border-radius: 0 0 8px 8px;
    position: relative;
    overflow: hidden;
  }
  .glass-fill {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    background: ${waterColor};
    opacity: 0.65;
    height: ${fillPercent.toFixed(1)}%;
    transition: height 0.5s ease, background 0.3s ease;
  }
  .glass-pct {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700;
  }
  .glass-cap {
    font-size: 9px;
    color: var(--vscode-descriptionForeground);
    text-align: center;
  }
  .stat-block { flex: 1; }
  .stat-value {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: ${waterColor};
    line-height: 1.1;
  }
  .stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  /* ── Comparison strip ── */
  .comparison {
    font-size: 12px;
    font-style: italic;
    color: var(--vscode-descriptionForeground);
    border-left: 2px solid ${waterColor};
    padding: 3px 0 3px 8px;
    margin-bottom: 12px;
    opacity: 0.85;
  }

  /* ── Meta strip ── */
  .meta {
    display: flex;
    gap: 0;
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 14px;
  }
  .meta-cell {
    flex: 1;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-right: 1px solid var(--vscode-widget-border, #454545);
  }
  .meta-cell:last-child { border-right: none; }
  .meta-val { font-size: 13px; font-weight: 700; }
  .meta-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }

  /* ── All-time strip ── */
  .alltime {
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .alltime-label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .alltime-val { font-size: 13px; font-weight: 700; }

  /* ── Section label ── */
  .section-label {
    font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 5px;
  }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  td {
    padding: 4px 4px;
    font-size: 11px;
    border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--vscode-descriptionForeground);
  }
  td.td-model { color: var(--vscode-foreground); font-weight: 500; max-width: 100px; }
  td.td-water { font-weight: 700; }

  /* ── Empty state ── */
  .empty {
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    padding: 16px 0 10px;
    line-height: 1.8;
  }
  .empty strong { color: var(--vscode-foreground); }

  /* ── Actions ── */
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  button {
    background: var(--vscode-button-secondaryBackground, #3a3a3a);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none; border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px; cursor: pointer;
    font-family: var(--vscode-font-family);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, #444); }
  button.primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }

  .links {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--vscode-widget-border, #3c3c3c);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.7;
  }
  .links a {
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    text-decoration: none;
  }
  .links a:hover { text-decoration: underline; }
  .links .row { margin-bottom: 2px; }
</style>
</head>
<body>

<div class="header">
  <span class="header-title">BlueToken</span>
  <span class="header-badge">AI Water Footprint</span>
</div>

<!-- ── Glass + main stat ── -->
<div class="hero">
  <div class="glass-wrap">
    <div class="glass">
      <div class="glass-fill"></div>
      <div class="glass-pct">${fillPercent.toFixed(0)}%</div>
    </div>
    <div class="glass-cap">of ${glassCapLabel}</div>
  </div>
  <div class="stat-block">
    <div class="stat-value">${sessionLabel}</div>
    <div class="stat-label">freshwater · this session</div>
  </div>
</div>

${comparison ? `<div class="comparison">= ${comparison}</div>` : ""}

<!-- ── Meta strip ── -->
<div class="meta">
  <div class="meta-cell">
    <span class="meta-val">${messageCount}</span>
    <span class="meta-lbl">Messages</span>
  </div>
  <div class="meta-cell">
    <span class="meta-val">${totalTokens.toLocaleString()}</span>
    <span class="meta-lbl">Tokens</span>
  </div>
  <div class="meta-cell">
    <span class="meta-val">${sessionDurationMin}m</span>
    <span class="meta-lbl">Duration</span>
  </div>
</div>

<!-- ── All-time ── -->
<div class="alltime">
  <span class="alltime-label">All-time total</span>
  <span class="alltime-val">${formatWater(allTimeMl)}</span>
</div>

<!-- ── Recent messages ── -->
${
  recentEntries.length > 0
    ? `<div class="section-label">Recent messages</div>
<table><tbody>${rows}</tbody></table>`
    : `<div class="empty">
  <strong>No AI messages tracked yet.</strong><br>
  Use <code>@bluetoken</code> in chat, or run<br>
  <em>BlueToken: Log Token Usage</em> from the<br>
  command palette to log manually.
</div>`
}

<!-- ── Actions ── -->
<div class="actions">
  <button class="primary" onclick="post('logTokens')">Log usage</button>
  <button onclick="post('resetSession')">Reset session</button>
  <button onclick="post('resetAllTime')" title="Clear all-time totals too">Reset all</button>
</div>

<div class="links">
  <div class="section-label">About & research</div>
  <div class="row"><a href="#" onclick="post('openResearch');return false;">Research papers (AI water footprint)</a></div>
  ${
    isPlaceholderUrl(LINKS.repository)
      ? `<div class="row">GitHub: set URL in src/links.ts</div>`
      : `<div class="row"><a href="#" onclick="post('openGithub');return false;">★ Star on GitHub</a></div>`
  }
  <div class="row"><a href="#" onclick="post('openProject');return false;">Author site · shubhamvishwakarma.com</a></div>
  <div class="row" style="margin-top:6px;opacity:0.85">
    ${LINKS.papers
      .map(
        (p) =>
          `<a href="#" onclick="post('openExternal',${JSON.stringify(p.url)});return false;">${escHtml(p.label)}</a>`
      )
      .join("<br>")}
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function post(command, url) {
    vscode.postMessage(url ? { command, url } : { command });
  }
</script>
</body>
</html>`;
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
