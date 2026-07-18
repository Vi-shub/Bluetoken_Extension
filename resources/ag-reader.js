/*
 * BlueToken Antigravity reader.
 *
 * Usage:  <node> ag-reader.js <conversationsDir> [mode]
 *   mode = "outputOnly" (default) | "incremental" | "fullApi"
 *
 * Output JSON:
 *   {
 *     ok, mode, inputTokens, outputTokens, steps, sessions,
 *     events: [{ sessionId, idx, tokens, atMs }]
 *   }
 *
 * atMs comes from steps.metadata protobuf timestamps (real generation time),
 * NOT the wall clock when BlueToken polls.
 */

"use strict";

function decodeVarint(data, pos) {
  let val = 0;
  let shift = 0;
  while (pos < data.length) {
    const b = data[pos++];
    val |= (b & 0x7f) << shift;
    if (!(b & 0x80)) {
      break;
    }
    shift += 7;
    if (shift > 63) {
      throw new Error("varint too long");
    }
  }
  return [val >>> 0, pos];
}

function walkFields(data, onField) {
  let pos = 0;
  const end = data.length;
  while (pos < end) {
    let key;
    try {
      [key, pos] = decodeVarint(data, pos);
    } catch {
      break;
    }
    const wireType = key & 7;
    const fieldNum = key >>> 3;
    if (wireType === 0) {
      let val;
      [val, pos] = decodeVarint(data, pos);
      onField(fieldNum, 0, val, pos);
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 2) {
      let length;
      [length, pos] = decodeVarint(data, pos);
      if (pos + length > end) {
        break;
      }
      const valBytes = data.subarray(pos, pos + length);
      pos += length;
      onField(fieldNum, 2, valBytes, pos);
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }
}

function findLengthDelimited(data, targetField) {
  let found = null;
  walkFields(data, (fieldNum, wireType, value) => {
    if (found) {
      return;
    }
    if (fieldNum === targetField && wireType === 2) {
      found = Buffer.isBuffer(value) ? value : Buffer.from(value);
    }
  });
  return found;
}

function readVarintFields(data) {
  const vals = {};
  walkFields(data, (fieldNum, wireType, value) => {
    if (wireType === 0 && typeof value === "number") {
      vals[fieldNum] = value;
    }
  });
  return vals;
}

function extractStepTokens(blob) {
  const data = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  let metricsBytes = null;
  const f1 = findLengthDelimited(data, 1);
  if (f1) {
    metricsBytes = findLengthDelimited(f1, 4);
  }
  if (!metricsBytes) {
    const f17 = findLengthDelimited(data, 17);
    if (f17) {
      metricsBytes = findLengthDelimited(f17, 2);
    }
  }
  if (!metricsBytes) {
    return null;
  }
  const vals = readVarintFields(metricsBytes);
  const input = typeof vals[5] === "number" ? vals[5] : 0;
  const output = typeof vals[3] === "number" ? vals[3] : 0;
  if (input === 0 && output === 0 && Object.keys(vals).length === 0) {
    return null;
  }
  return { input, output };
}

/** Collect unix-seconds that look like real 2020–2100 timestamps from a blob. */
function collectUnixSeconds(data, out, depth = 0) {
  if (!data || depth > 4) {
    return;
  }
  walkFields(data, (fieldNum, wireType, value) => {
    if (wireType === 0 && typeof value === "number") {
      if (value > 1_600_000_000 && value < 4_000_000_000) {
        out.push(value);
      }
    } else if (wireType === 2) {
      collectUnixSeconds(Buffer.from(value), out, depth + 1);
    }
  });
}

function extractAtMs(metadataBlob, payloadBlob) {
  const secs = [];
  if (metadataBlob) {
    collectUnixSeconds(Buffer.from(metadataBlob), secs);
  }
  if (payloadBlob) {
    collectUnixSeconds(Buffer.from(payloadBlob), secs);
  }
  if (secs.length === 0) {
    return 0;
  }
  // Prefer the latest timestamp on the step (completion-ish).
  return Math.max(...secs) * 1000;
}

function billableTokens(steps, mode) {
  // steps: [{idx, input, output, atMs}]
  const events = [];
  let inputTokens = 0;
  let outputTokens = 0;

  if (mode === "fullApi") {
    for (const t of steps) {
      inputTokens += t.input;
      outputTokens += t.output;
      const tokens = t.input + t.output;
      if (tokens > 0) {
        events.push({ idx: t.idx, tokens, atMs: t.atMs });
      }
    }
  } else if (mode === "incremental") {
    let prevContext = 0;
    let seenContext = false;
    for (const t of steps) {
      outputTokens += t.output;
      let ctxDelta = 0;
      if (t.input > 0) {
        if (!seenContext) {
          ctxDelta = t.input;
          seenContext = true;
          prevContext = t.input;
        } else if (t.input > prevContext) {
          ctxDelta = t.input - prevContext;
          prevContext = t.input;
        } else {
          prevContext = t.input;
        }
      }
      inputTokens += ctxDelta;
      const tokens = ctxDelta + t.output;
      if (tokens > 0) {
        events.push({ idx: t.idx, tokens, atMs: t.atMs });
      }
    }
  } else {
    for (const t of steps) {
      outputTokens += t.output;
      if (t.output > 0) {
        events.push({ idx: t.idx, tokens: t.output, atMs: t.atMs });
      }
    }
  }

  return { inputTokens, outputTokens, events };
}

function readSessionDb(dbPath, DatabaseSync, mode, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const timeByIdx = {};
    try {
      const stepRows = db
        .prepare("SELECT idx, metadata, step_payload FROM steps ORDER BY idx ASC")
        .all();
      for (const s of stepRows) {
        timeByIdx[s.idx] = extractAtMs(s.metadata, s.step_payload);
      }
    } catch {
      /* steps table missing — timestamps stay 0 */
    }

    const rows = db.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx ASC").all();
    const steps = [];
    for (const r of rows) {
      const t = extractStepTokens(r.data);
      if (!t) {
        continue;
      }
      steps.push({
        idx: r.idx,
        input: t.input,
        output: t.output,
        atMs: timeByIdx[r.idx] || 0,
      });
    }

    const billed = billableTokens(steps, mode);
    return {
      inputTokens: billed.inputTokens,
      outputTokens: billed.outputTokens,
      steps: steps.length,
      events: billed.events.map((e) => ({
        sessionId,
        idx: e.idx,
        tokens: e.tokens,
        atMs: e.atMs,
      })),
    };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const convDir = process.argv[2];
  const modeArg = (process.argv[3] || "outputOnly").toLowerCase();
  const mode =
    modeArg === "fullapi" ? "fullApi" : modeArg === "incremental" ? "incremental" : "outputOnly";
  if (!convDir) {
    return { ok: false, error: "no conversations dir" };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (e) {
    return { ok: false, error: "node:sqlite unavailable: " + (e && e.message) };
  }

  const fs = require("node:fs");
  const path = require("node:path");

  let files;
  try {
    files = fs.readdirSync(convDir).filter((f) => f.endsWith(".db"));
  } catch (e) {
    return { ok: false, error: "readdir failed: " + (e && e.message) };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  let sessions = 0;
  const events = [];

  for (const f of files) {
    const dbPath = path.join(convDir, f);
    const sessionId = f.replace(/\.db$/i, "");
    try {
      const r = readSessionDb(dbPath, DatabaseSync, mode, sessionId);
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      steps += r.steps;
      sessions++;
      for (const e of r.events) {
        events.push(e);
      }
    } catch {
      /* skip locked/corrupt */
    }
  }

  return { ok: true, inputTokens, outputTokens, steps, sessions, mode, events };
}

try {
  process.stdout.write(JSON.stringify(main()));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message) }));
}
