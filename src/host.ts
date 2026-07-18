import * as vscode from "vscode";

export type HostKind = "cursor" | "antigravity" | "vscode" | "other";

/** Detect which editor is hosting this extension instance. */
export function detectHost(): HostKind {
  const name = (vscode.env.appName || "").toLowerCase();
  if (name.includes("cursor")) {
    return "cursor";
  }
  if (name.includes("antigravity")) {
    return "antigravity";
  }
  if (name.includes("visual studio code") || name === "code" || name.includes("vscode")) {
    return "vscode";
  }
  return "other";
}

/**
 * Poll the host's own chat source often; poll other IDEs less often.
 * Cuts spawn/CPU when Cursor + VS Code + Antigravity all run at once.
 */
export function pollIntervalsMs(baseMs: number): {
  cursor: number;
  antigravity: number;
  copilot: number;
} {
  const base = Math.max(10_000, baseMs);
  const slow = Math.max(base * 3, 60_000);
  const host = detectHost();
  switch (host) {
    case "cursor":
      return { cursor: base, antigravity: slow, copilot: slow };
    case "antigravity":
      return { cursor: slow, antigravity: base, copilot: slow };
    case "vscode":
      return { cursor: slow, antigravity: slow, copilot: base };
    default:
      return { cursor: base, antigravity: base, copilot: base };
  }
}
