/*
 * BlueToken DB reader (Cursor).
 *
 * Usage:  <node> db-reader.js <cursorStateDbPath>
 * Output: one JSON line:
 *   { ok, inputTokens, outputTokens, bubbles, nonZero, estimatedBubbles }
 *
 * Only counts bubbleId rows (one logical chat/composer message each).
 * Extra KV keys (composerData / agentKv / messageRequestContext) often
 * duplicate the same content and inflate totals — file Apply is tracked
 * separately by the extension's file-edit watcher.
 *
 * Cursor often leaves tokenCount at 0 even when the bubble has text:
 *   - If input+output > 0 → exact counts
 *   - Else estimate from text / code fields
 */

"use strict";

function estimateTokens(text) {
  if (!text || typeof text !== "string") {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function collectText(o) {
  if (!o || typeof o !== "object") {
    return "";
  }
  const chunks = [];
  const push = (v) => {
    if (typeof v === "string" && v.length > 0) {
      chunks.push(v);
    }
  };

  push(o.text);
  push(o.rawText);
  push(o.richText);
  push(o.markdown);
  push(o.content);
  push(o.thinking);
  push(o.thinkingText);

  if (Array.isArray(o.codeBlocks)) {
    for (const b of o.codeBlocks) {
      if (!b) continue;
      push(b.code);
      push(b.content);
      push(b.text);
    }
  }
  if (Array.isArray(o.suggestedCodeBlocks)) {
    for (const b of o.suggestedCodeBlocks) {
      if (!b) continue;
      push(b.code);
      push(b.content);
      push(b.text);
    }
  }
  if (Array.isArray(o.parts)) {
    for (const p of o.parts) {
      if (!p) continue;
      push(p.text);
      push(p.content);
      if (p.code) push(p.code);
    }
  }

  return chunks.join("\n");
}

function tokensFromObject(o) {
  if (!o || typeof o !== "object") {
    return { input: 0, output: 0, estimated: false };
  }

  const i = o.tokenCount ? Number(o.tokenCount.inputTokens) || 0 : 0;
  const t = o.tokenCount ? Number(o.tokenCount.outputTokens) || 0 : 0;
  if (i + t > 0) {
    return { input: i, output: t, estimated: false };
  }

  const usage = o.usage || o.tokenUsage || o.tokens;
  if (usage && typeof usage === "object") {
    const ui = Number(usage.inputTokens ?? usage.promptTokens ?? usage.input) || 0;
    const uo = Number(usage.outputTokens ?? usage.completionTokens ?? usage.output) || 0;
    if (ui + uo > 0) {
      return { input: ui, output: uo, estimated: false };
    }
  }

  const est = estimateTokens(collectText(o));
  if (est > 0) {
    return { input: 0, output: est, estimated: true };
  }
  return { input: 0, output: 0, estimated: false };
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
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
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
      const tok = tokensFromObject(o);
      if (tok.input + tok.output <= 0) {
        continue;
      }
      if (tok.estimated) {
        estimatedBubbles++;
      } else {
        nonZero++;
      }
      inputTokens += tok.input;
      outputTokens += tok.output;
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
