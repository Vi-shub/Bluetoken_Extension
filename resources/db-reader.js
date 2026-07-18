/*
 * BlueToken DB reader (Cursor).
 *
 * Usage:  <node> db-reader.js <cursorStateDbPath>
 * Output: one JSON line:
 *   { ok, inputTokens, outputTokens, bubbles, nonZero, estimatedBubbles }
 *
 * Cursor often leaves tokenCount at 0 even when the bubble has text.
 * Strategy:
 *   - If input+output > 0 → use exact counts
 *   - Else if bubble has text → estimate tokens as ceil(text.length / 4)
 */

"use strict";

function estimateTokens(text) {
  if (!text || typeof text !== "string") {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    return { ok: false, error: "no db path" };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (e) {
    return { ok: false, error: "node:sqlite unavailable: " + (e && e.message) };
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return { ok: false, error: "open failed: " + (e && e.message) };
  }

  try {
    const rows = db
      .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
      .all();

    let inputTokens = 0;
    let outputTokens = 0;
    let bubbles = 0;
    let nonZero = 0;
    let estimatedBubbles = 0;

    for (const r of rows) {
      let o;
      try {
        o = JSON.parse(r.value.toString());
      } catch {
        continue;
      }
      if (!o) {
        continue;
      }

      bubbles++;
      const i = o.tokenCount ? Number(o.tokenCount.inputTokens) || 0 : 0;
      const t = o.tokenCount ? Number(o.tokenCount.outputTokens) || 0 : 0;

      if (i + t > 0) {
        nonZero++;
        inputTokens += i;
        outputTokens += t;
        continue;
      }

      // Fallback: many Cursor bubbles never get tokenCount filled in.
      const est = estimateTokens(o.text);
      if (est > 0) {
        estimatedBubbles++;
        outputTokens += est;
      }
    }

    return {
      ok: true,
      inputTokens,
      outputTokens,
      bubbles,
      nonZero,
      estimatedBubbles,
    };
  } catch (e) {
    return { ok: false, error: "query failed: " + (e && e.message) };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

try {
  process.stdout.write(JSON.stringify(main()));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message) }));
}
