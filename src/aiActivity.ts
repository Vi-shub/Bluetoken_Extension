/**
 * Shared "AI was just active" signal so disk file writes can be attributed
 * to the agent/Composer without counting every human save.
 *
 * Also tracks when Cursor DB already counted a file-edit delta, so the
 * workspace disk watcher can skip a short window (avoid double-billing).
 */

let lastAiActivityMs = 0;
let suppressDiskUntilMs = 0;

export function markAiActivity(): void {
  lastAiActivityMs = Date.now();
}

/** True if chat/agent activity was seen within the last `withinMs`. */
export function aiActiveRecently(withinMs = 180_000): boolean {
  return lastAiActivityMs > 0 && Date.now() - lastAiActivityMs < withinMs;
}

/** DB already recorded file-edit tokens — ignore disk deltas briefly. */
export function suppressDiskFileEditsFor(ms: number): void {
  suppressDiskUntilMs = Math.max(suppressDiskUntilMs, Date.now() + ms);
}

export function diskFileEditsSuppressed(): boolean {
  return Date.now() < suppressDiskUntilMs;
}
