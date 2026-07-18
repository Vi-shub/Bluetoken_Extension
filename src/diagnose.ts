import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { log } from "./log";
import { CursorUsageReader } from "./cursorReader";
import { AntigravityUsageReader } from "./antigravityReader";
import { CopilotUsageReader } from "./copilotReader";
import { runDbReader } from "./dbRunner";

/** Runs a full environment check and writes it to the BlueToken output channel. */
export async function runDiagnostics(context: vscode.ExtensionContext): Promise<string> {
  const lines: string[] = [];
  const add = (s: string) => {
    lines.push(s);
    log.info(s);
  };

  add("======== BlueToken Diagnose ========");
  add(`platform=${process.platform} arch=${process.arch}`);
  add(`node=${process.version} execPath=${process.execPath}`);
  add(`electron=${(process.versions as { electron?: string }).electron ?? "n/a"}`);
  add(`appName=${vscode.env.appName} uiKind=${vscode.env.uiKind}`);
  add(`extensionPath=${context.extensionPath}`);
  add(`globalStorage=${context.globalStorageUri.fsPath}`);

  // Cursor
  const cursorDb = CursorUsageReader.locateDb();
  add(`--- Cursor ---`);
  add(`db=${cursorDb ?? "NOT FOUND"}`);
  if (cursorDb) {
    try {
      const st = fs.statSync(cursorDb);
      add(`dbSizeMB=${(st.size / 1e6).toFixed(1)} mtime=${st.mtime.toISOString()}`);
    } catch (e) {
      add(`dbStatError=${String(e)}`);
    }
    const script = context.asAbsolutePath(path.join("resources", "db-reader.js"));
    add(`scriptExists=${fs.existsSync(script)} path=${script}`);
    const r = await runDbReader(script, cursorDb, 45000);
    add(`readerResult ok=${r.ok} error=${r.error ?? ""} in=${r.inputTokens} out=${r.outputTokens} bubbles=${r.bubbles}`);
  }

  // Antigravity
  add(`--- Antigravity ---`);
  const agDir = AntigravityUsageReader.locateConversationsDir();
  add(`conversationsDir=${agDir ?? "NOT FOUND"}`);
  add(`candidatesTried=${AntigravityUsageReader.listCandidateDirs().join(" | ")}`);
  if (agDir) {
    try {
      const dbs = fs.readdirSync(agDir).filter((f) => f.endsWith(".db"));
      add(`dbCount=${dbs.length} sample=${dbs.slice(0, 3).join(",")}`);
    } catch (e) {
      add(`readdirError=${String(e)}`);
    }
    const script = context.asAbsolutePath(path.join("resources", "ag-reader.js"));
    const r = await runDbReader(script, agDir, 45000, ["outputOnly"]);
    add(
      `readerResult ok=${r.ok} error=${r.error ?? ""} in=${r.inputTokens} out=${r.outputTokens} steps=${r.steps} events=${r.events?.length ?? 0}`
    );
  }

  // Copilot
  add(`--- Copilot ---`);
  const userDirs = CopilotUsageReader.locateAllUserDataDirs(context);
  add(`userDataDirs=${userDirs.join(" | ") || "NONE"}`);
  for (const userDir of userDirs) {
    add(`  dir=${userDir}`);
    try {
      const files = CopilotUsageReader.discoverSessionFiles(userDir);
      add(`    sessionFiles=${files.length}`);
      const recent = files
        .map((f) => {
          try {
            const st = fs.statSync(f);
            return { f, m: st.mtimeMs, sz: st.size };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ f: string; m: number; sz: number }>;
      recent.sort((a, b) => b.m - a.m);
      for (const r of recent.slice(0, 8)) {
        add(`    ${new Date(r.m).toISOString()} ${(r.sz / 1024).toFixed(1)}KB ${r.f}`);
      }
    } catch (e) {
      add(`    discoverError=${String(e)}`);
    }
  }

  add(`homedir=${os.homedir()} APPDATA=${process.env.APPDATA ?? ""}`);
  add("======== End Diagnose ========");
  add("Copy this log if asking for help.");

  return lines.join("\n");
}
