/**
 * Brief window after a Cursor chat DB delta where file-edit tracking is
 * suppressed — Composer Apply often lands the same text into the editor
 * right after the bubble updates, which would double-count.
 */
let suppressFileEditsUntilMs = 0;

export function suppressFileEditsFor(ms: number): void {
  suppressFileEditsUntilMs = Math.max(suppressFileEditsUntilMs, Date.now() + ms);
}

export function fileEditsSuppressed(): boolean {
  return Date.now() < suppressFileEditsUntilMs;
}
