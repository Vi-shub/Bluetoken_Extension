import * as fs from "node:fs";
import * as path from "node:path";

/** Stable key for path de-duplication across Windows case variants. */
export function normalizePathKey(p: string): string {
  const n = path.normalize(p);
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/** Resolve a path to its real location when possible (dedupes case aliases). */
export function realPathSafe(p: string): string {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    return path.normalize(p);
  }
}

/** Fingerprint a single file (mtime + size). Null if missing. */
export function fingerprintFile(filePath: string): string | null {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

/**
 * Fingerprint a SQLite DB including -wal / -shm.
 * Cursor/Antigravity often write to the WAL first; the main .vscdb/.db
 * mtime can stay unchanged for a long time — skipping on main-file-only
 * fingerprints misses live chat until a checkpoint (or a manual refresh).
 */
export function fingerprintSqlite(dbPath: string): string | null {
  const parts = [fingerprintFile(dbPath), fingerprintFile(`${dbPath}-wal`), fingerprintFile(`${dbPath}-shm`)];
  if (parts.every((p) => p === null)) {
    return null;
  }
  return parts.map((p) => p ?? "-").join("|");
}

/** Fingerprint all *.db files in a directory (sorted), including WAL/SHM. */
export function fingerprintDbDir(dir: string): string | null {
  try {
    if (!fs.existsSync(dir)) {
      return null;
    }
    const dbs = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".db"))
      .sort();
    if (dbs.length === 0) {
      const st = fs.statSync(dir);
      return `dir:${st.mtimeMs}`;
    }
    return dbs
      .map((f) => {
        const full = path.join(dir, f);
        return `${f}:${fingerprintSqlite(full) ?? "?"}`;
      })
      .join("|");
  } catch {
    return null;
  }
}

/** Fingerprint a list of files (order-independent). */
export function fingerprintFiles(files: string[]): string {
  const parts = files
    .map((f) => {
      const fp = fingerprintFile(f);
      return fp ? `${normalizePathKey(f)}=${fp}` : null;
    })
    .filter((x): x is string => !!x)
    .sort();
  return parts.join("|");
}
