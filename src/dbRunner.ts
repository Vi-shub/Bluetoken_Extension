import { spawn } from "node:child_process";
import { log } from "./log";

export interface DbReadResult {
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  bubbles?: number;
  nonZero?: number;
  estimatedBubbles?: number;
  steps?: number;
  sessions?: number;
  events?: Array<{ sessionId: string; idx: number; tokens: number; atMs: number }>;
  error?: string;
}

export type CursorReadResult = DbReadResult;

/** Extract the last JSON object from mixed stdout (warnings may appear). */
function parseJsonLine(out: string): DbReadResult | null {
  const trimmed = out.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        return JSON.parse(line);
      } catch {
        /* continue */
      }
    }
  }
  const start = trimmed.lastIndexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Runs a plain-JS DB reader via the editor's Node runtime
 * (ELECTRON_RUN_AS_NODE=1) so `node:sqlite` is available when the host supports it.
 */
export function runDbReader(
  scriptPath: string,
  argPath: string,
  timeoutMs = 20000,
  extraArgs: string[] = []
): Promise<DbReadResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: DbReadResult) => {
      if (!settled) {
        settled = true;
        if (!r.ok) {
          log.warn(`dbReader fail: ${r.error} (script=${scriptPath} arg=${argPath})`);
        } else {
          log.debug(
            `dbReader ok: in=${r.inputTokens} out=${r.outputTokens} bubbles=${r.bubbles} steps=${r.steps} events=${r.events?.length ?? 0}`
          );
        }
        resolve(r);
      }
    };

    log.debug(`dbReader spawn execPath=${process.execPath} script=${scriptPath}`);

    let child;
    try {
      child = spawn(process.execPath, [scriptPath, argPath, ...extraArgs], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
      });
    } catch (e) {
      finish({ ok: false, error: "spawn failed: " + String(e) });
      return;
    }

    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({ ok: false, error: "timeout after " + timeoutMs + "ms" });
    }, timeoutMs);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("error", (e) => {
      clearTimeout(timer);
      finish({ ok: false, error: "process error: " + String(e) });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = parseJsonLine(out);
      if (parsed) {
        finish(parsed);
        return;
      }
      finish({
        ok: false,
        error:
          `unparseable (exit=${code}): stderr=${err.slice(0, 300)} stdout=${out.slice(0, 300)}`,
      });
    });
  });
}

export function runCursorReader(
  scriptPath: string,
  dbPath: string,
  timeoutMs = 20000
): Promise<DbReadResult> {
  return runDbReader(scriptPath, dbPath, timeoutMs);
}
