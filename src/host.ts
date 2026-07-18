import * as vscode from "vscode";

export type HostKind = "cursor" | "antigravity" | "vscode" | "other";

export type ReaderKind = "cursor" | "copilot" | "antigravity";

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

export function hostDisplayName(host: HostKind = detectHost()): string {
  switch (host) {
    case "cursor":
      return "Cursor";
    case "antigravity":
      return "Antigravity";
    case "vscode":
      return "VS Code";
    default:
      return vscode.env.appName || "Editor";
  }
}

/**
 * Which chat readers belong to this IDE by default.
 * Keeps Cursor / VS Code / Antigravity counts separate unless the user opts in.
 */
export function nativeReadersForHost(host: HostKind = detectHost()): ReaderKind[] {
  switch (host) {
    case "cursor":
      return ["cursor"];
    case "antigravity":
      return ["antigravity"];
    case "vscode":
      return ["copilot"];
    default:
      return ["cursor", "copilot", "antigravity"];
  }
}

/** Decide which readers to start given settings + current host. */
export function readersToStart(opts: {
  trackCursor: boolean;
  trackCopilot: boolean;
  trackAntigravity: boolean;
  trackOtherIdes: boolean;
  host?: HostKind;
}): ReaderKind[] {
  const host = opts.host ?? detectHost();
  const native = new Set(nativeReadersForHost(host));
  const allow = (kind: ReaderKind, settingOn: boolean): boolean => {
    if (!settingOn) {
      return false;
    }
    return opts.trackOtherIdes || native.has(kind);
  };

  const out: ReaderKind[] = [];
  if (allow("cursor", opts.trackCursor)) {
    out.push("cursor");
  }
  if (allow("copilot", opts.trackCopilot)) {
    out.push("copilot");
  }
  if (allow("antigravity", opts.trackAntigravity)) {
    out.push("antigravity");
  }
  return out;
}

/**
 * Poll the host's own chat source often; poll other IDEs less often
 * (only when trackOtherIdes is enabled).
 */
export function pollIntervalsMs(baseMs: number): {
  cursor: number;
  antigravity: number;
  copilot: number;
} {
  const base = Math.max(3_000, baseMs);
  const slow = Math.max(base * 4, 30_000);
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

/** Whether a recorded session entry belongs to this host's native chat source. */
export function entryBelongsToHost(source: string, host: HostKind = detectHost()): boolean {
  const s = source.toLowerCase();
  // Manual / shared actions stay visible in every IDE.
  if (
    s.includes("quick-track") ||
    s.includes("manual log") ||
    s.includes("ai edit") ||
    s.includes("(auto)")
  ) {
    return true;
  }
  switch (host) {
    case "cursor":
      return s.includes("cursor");
    case "antigravity":
      return s.includes("antigravity");
    case "vscode":
      return s.includes("copilot");
    default:
      return true;
  }
}
