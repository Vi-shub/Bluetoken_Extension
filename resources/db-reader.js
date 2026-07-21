/*
 * BlueToken DB reader (Cursor).
 *
 * Usage:  <node> db-reader.js <cursorStateDbPath>
 * Output: one JSON line:
 *   { ok, inputTokens, outputTokens, bubbles, nonZero, estimatedBubbles,
 *     fileEditTokens, fileEditSources }
 *
 * Chat: bubbleId rows only (exact tokenCount or text estimate).
 * File edits (separate total — do NOT mix into chat):
 *   - codeBlockDiff:* payloads (Composer Apply diffs)
 *   - bubble toolFormerData for Write / StrReplace / edit tools
 * Tool-edit bubbles are excluded from chat text estimates to reduce double-count.
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

/** Tool names that write/patch files (Cursor Agent / Composer). */
const EDIT_TOOL_RE =
  /^(write|strreplace|search_replace|apply_patch|edit_file|editfile|create_file|createfile|delete_file|notebook_edit|multiedit|applypatch)$/i;

function toolNameOf(tf) {
  if (!tf || typeof tf !== "object") {
    return "";
  }
  return String(
    tf.name ||
      tf.tool ||
      tf.toolName ||
      tf.tool_name ||
      tf.function?.name ||
      tf.rawToolName ||
      ""
  );
}

function isFileEditTool(name) {
  if (!name) {
    return false;
  }
  const n = name.replace(/[^a-zA-Z0-9_]/g, "");
  return EDIT_TOOL_RE.test(n) || /write|strreplace|searchreplace|applypatch|editfile/i.test(n);
}

function bubbleHasFileEditTool(o) {
  if (!o || typeof o !== "object") {
    return false;
  }
  if (o.toolFormerData && isFileEditTool(toolNameOf(o.toolFormerData))) {
    return true;
  }
  if (Array.isArray(o.toolResults)) {
    for (const t of o.toolResults) {
      if (isFileEditTool(toolNameOf(t))) {
        return true;
      }
    }
  }
  return false;
}

function pushString(chunks, v) {
  if (typeof v === "string" && v.length > 0) {
    chunks.push(v);
  }
}

/** Best-effort extract of "new file content" from a tool payload. */
function contentFromToolPayload(tf) {
  if (!tf || typeof tf !== "object") {
    return "";
  }
  const chunks = [];
  const params = tf.params || tf.parameters || tf.args || tf.input || tf.rawArgs || {};
  const p = typeof params === "string" ? tryParseJson(params) || {} : params;

  pushString(chunks, p.contents);
  pushString(chunks, p.content);
  pushString(chunks, p.new_string);
  pushString(chunks, p.newString);
  pushString(chunks, p.new_text);
  pushString(chunks, p.newText);
  pushString(chunks, p.updated_string);
  pushString(chunks, p.code);
  pushString(chunks, p.patch);
  pushString(chunks, p.diff);

  // Sometimes the whole args blob is a JSON string with nested fields.
  if (typeof tf.rawArgs === "string" && tf.rawArgs.length > 20) {
    const raw = tryParseJson(tf.rawArgs);
    if (raw && typeof raw === "object") {
      pushString(chunks, raw.contents);
      pushString(chunks, raw.content);
      pushString(chunks, raw.new_string);
      pushString(chunks, raw.newString);
    } else if (!p.contents && !p.new_string) {
      // Fall back: count raw args length (rough) only if nothing else found.
      if (chunks.length === 0) {
        pushString(chunks, tf.rawArgs);
      }
    }
  }

  pushString(chunks, tf.result);
  pushString(chunks, typeof tf.output === "string" ? tf.output : "");

  return chunks.join("\n");
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Extract added/new text from a codeBlockDiff value. */
function contentFromDiff(o) {
  if (!o || typeof o !== "object") {
    return "";
  }
  const chunks = [];
  pushString(chunks, o.newText);
  pushString(chunks, o.new_text);
  pushString(chunks, o.newString);
  pushString(chunks, o.new_string);
  pushString(chunks, o.contents);
  pushString(chunks, o.content);
  pushString(chunks, o.addedText);
  pushString(chunks, o.updatedCode);
  pushString(chunks, o.code);

  if (typeof o.diff === "string") {
    // Prefer added lines from unified diff.
    const added = o.diff
      .split(/\r?\n/)
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n");
    if (added.length > 0) {
      pushString(chunks, added);
    } else {
      pushString(chunks, o.diff);
    }
  }

  if (Array.isArray(o.changes)) {
    for (const c of o.changes) {
      if (!c) continue;
      pushString(chunks, c.newText || c.new_text || c.added || c.text);
    }
  }

  return chunks.join("\n");
}

function fileEditTokensFromBubble(o) {
  let total = 0;
  if (o.toolFormerData && isFileEditTool(toolNameOf(o.toolFormerData))) {
    total += estimateTokens(contentFromToolPayload(o.toolFormerData));
  }
  if (Array.isArray(o.toolResults)) {
    for (const t of o.toolResults) {
      if (isFileEditTool(toolNameOf(t))) {
        total += estimateTokens(contentFromToolPayload(t));
      }
    }
  }
  return total;
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
    const bubbles = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
      .all();

    let inputTokens = 0;
    let outputTokens = 0;
    let bubbleCount = 0;
    let nonZero = 0;
    let estimatedBubbles = 0;
    let fileEditTokens = 0;
    let fileEditFromTools = 0;
    let fileEditFromDiffs = 0;

    for (const r of bubbles) {
      let o;
      try {
        o = JSON.parse(r.value.toString());
      } catch {
        continue;
      }
      if (!o) {
        continue;
      }

      bubbleCount++;

      // Agent Write/StrReplace → count under file edits, not chat text estimate.
      const toolEditTok = fileEditTokensFromBubble(o);
      if (toolEditTok > 0) {
        fileEditTokens += toolEditTok;
        fileEditFromTools++;
      }

      const isToolEdit = bubbleHasFileEditTool(o);
      if (isToolEdit) {
        // Still take exact tokenCount if Cursor stored it on the tool bubble.
        const i = o.tokenCount ? Number(o.tokenCount.inputTokens) || 0 : 0;
        const t = o.tokenCount ? Number(o.tokenCount.outputTokens) || 0 : 0;
        if (i + t > 0) {
          inputTokens += i;
          outputTokens += t;
          nonZero++;
        }
        // Skip text estimate — content lives in tool payload / disk apply.
        continue;
      }

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

    // Composer Apply diffs (accepted or not — still generated output to disk when applied).
    let diffRows = [];
    try {
      diffRows = db
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'codeBlockDiff:%'")
        .all();
    } catch {
      diffRows = [];
    }

    for (const r of diffRows) {
      let o;
      try {
        o = JSON.parse(r.value.toString());
      } catch {
        continue;
      }
      const tok = estimateTokens(contentFromDiff(o));
      if (tok > 0) {
        fileEditTokens += tok;
        fileEditFromDiffs++;
      }
    }

    return {
      ok: true,
      inputTokens,
      outputTokens,
      bubbles: bubbleCount,
      nonZero,
      estimatedBubbles,
      fileEditTokens,
      fileEditFromTools,
      fileEditFromDiffs,
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
