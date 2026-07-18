import * as path from "node:path";
import * as fs from "node:fs";

/** Stable path key for Set/Map dedupe (Windows is case-insensitive). */
export function normalizePathKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Deduplicate paths that differ only by casing/separators. */
export function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = normalizePathKey(p);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Fingerprint a file for change detection (mtime + size). */
export function fileFingerprint(filePath: string): string | null {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

/**
 * Fingerprint a directory by max mtime/size of matching files.
 * Skips expensive DB spawns when nothing on disk changed.
 */
export function dirFingerprint(dir: string, ext = ".db"): string | null {
  try {
    if (!fs.existsSync(dir)) {
      return null;
    }
    const names = fs.readdirSync(dir).filter((f) => f.endsWith(ext));
    if (names.length === 0) {
      const st = fs.statSync(dir);
      return `dir:${st.mtimeMs}:${names.length}`;
    }
    let maxM = 0;
    let totalSz = 0;
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(dir, name));
        maxM = Math.max(maxM, st.mtimeMs);
        totalSz += st.size;
      } catch {
        /* ignore */
      }
    }
    return `${names.length}:${maxM}:${totalSz}`;
  } catch {
    return null;
  }
}
