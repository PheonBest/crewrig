// q2q3-antigravity.ts — Q2/Q3: relative-command resolution and install destination of an Antigravity
// plugin, measured against the REAL customization root (uniquely named, collision-checked, removed in
// a finally by the caller through `cleanupAgy`).

import fs from "node:fs";

import { agyRewriteJsonResponse } from "./usage-adapter.ts";
import {
  launchInstant,
  line,
  mustRun,
  nonEmpty,
  normalDiff,
  onPath,
  prefixLines,
  runQuiet,
  runToFile,
  section,
  writeStub,
  type Ctx,
} from "./io.ts";

export const AGY_PROBE_NAME = "crewrig-probe-mcp-token";

export interface AgyState {
  /** Set once the install root is known to be ours; the finally block then runs `cleanupAgy`. */
  installRoot: string | null;
}

const MCP_CONFIG =
  '{"mcpServers":{"probe-args":{"command":"dist/stub.sh","args":["relative-form"],"cwd":""}}}\n';
const PROMPT =
  "List the names of every MCP tool available to you in this session, one per line, exactly as they are named, and nothing else.";

export function probeQ2Q3Antigravity(ctx: Ctx, state: AgyState): void {
  section(
    ctx,
    "Q2/Q3 — Antigravity CLI: relative resolution, install destination (REAL customization root)",
  );
  if (!onPath(ctx, "agy")) {
    line(ctx, "SKIP: agy not on PATH");
    ctx.failed = true;
    return;
  }
  const home = ctx.env["HOME"] ?? "";
  const root = `${home}/.gemini/config/plugins/${AGY_PROBE_NAME}`;
  if (exists(root)) {
    ctx.err(`ERROR: ${root} already exists — refusing to touch it.\n`);
    ctx.failed = true;
    return;
  }

  const src = `${ctx.work}/agy-plugin`;
  const log = `${ctx.work}/agy-invocation.log`;
  fs.mkdirSync(`${src}/dist`, { recursive: true });
  fs.writeFileSync(`${src}/plugin.json`, `{"name": "${AGY_PROBE_NAME}"}\n`);
  writeStub(`${src}/dist/stub.sh`, log);
  fs.writeFileSync(`${src}/mcp_config.json`, MCP_CONFIG);
  state.installRoot = root;

  line(ctx, `Installing probe plugin '${AGY_PROBE_NAME}'...`);
  mustRun(ctx, "agy", ["plugin", "install", src]);
  runQuiet(ctx, "agy", ["plugin", "enable", AGY_PROBE_NAME]);

  line(ctx);
  line(ctx, "-- Q3: installed location and rewrite check --");
  const installed = `${root}/mcp_config.json`;
  if (isFile(installed)) {
    line(
      ctx,
      `  installed at: ${root}  (matches the documented plugins/<name>/mcp_config.json root)`,
    );
    const a = fs.readFileSync(`${src}/mcp_config.json`);
    const b = fs.readFileSync(installed);
    if (a.equals(b)) {
      line(
        ctx,
        "  VERDICT: agy plugin install copies mcp_config.json VERBATIM — no token/path rewriting at install.",
      );
    } else {
      line(
        ctx,
        "  VERDICT: installed mcp_config.json DIFFERS from source — agy DID rewrite something:",
      );
      ctx.out(prefixLines(normalDiff(a.toString("latin1"), b.toString("latin1")), "    "));
    }
  } else {
    line(ctx, `  FAIL: ${root}/mcp_config.json was not created by the install.`);
    ctx.failed = true;
  }

  line(ctx);
  line(ctx, "-- Q2: relative command resolution (live session, forced tool-name listing) --");
  fs.rmSync(log, { force: true });
  const sessOut = `${ctx.work}/agy-session.log`;
  const instant = launchInstant();
  runToFile(ctx, "agy", ["-p", PROMPT, "--output-format", "json"], sessOut, { timeoutMs: 90_000 });
  agyRewriteJsonResponse(sessOut, instant, ctx.env, ctx.cwd);
  const session = fs.readFileSync(sessOut, "utf8");
  if (session.includes("probe-args")) {
    line(
      ctx,
      "  VERDICT: 'probe-args' IS in the tool list with a bare relative command — relative resolution WORKS.",
    );
    if (nonEmpty(log)) line(ctx, "  (and the stub actually ran — spawn confirmed)");
  } else {
    line(
      ctx,
      "  VERDICT: 'probe-args' is ABSENT from the tool list — relative resolution FAILS SILENTLY",
    );
    line(ctx, "           (no error surfaced to the operator; the tool is simply missing).");
    if (nonEmpty(log)) {
      line(
        ctx,
        "  UNEXPECTED: the invocation log is non-empty even though the tool was not listed:",
      );
      ctx.out(prefixLines(fs.readFileSync(log, "utf8"), "    "));
    }
  }
  line(ctx, `  (full tool listing saved for inspection: ${sessOut})`);
  ctx.out(prefixLines(session, "    "));
}

/** The shell's `cleanup_agy`: uninstall, remove the root, drop the plugin from config.json. */
export function cleanupAgy(ctx: Ctx, state: AgyState): void {
  if (state.installRoot === null) return;
  runQuiet(ctx, "agy", ["plugin", "uninstall", AGY_PROBE_NAME]);
  fs.rmSync(state.installRoot, { recursive: true, force: true });
  const cfg = `${ctx.env["HOME"] ?? ""}/.gemini/config/config.json`;
  if (!isFile(cfg)) return;
  try {
    const doc: unknown = JSON.parse(fs.readFileSync(cfg, "utf8"));
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return;
    const plugins = (doc as { plugins?: unknown }).plugins;
    if (typeof plugins === "object" && plugins !== null && !Array.isArray(plugins)) {
      delete (plugins as Record<string, unknown>)[AGY_PROBE_NAME];
    }
    const tmp = `${cfg}.probe-tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
    fs.renameSync(tmp, cfg);
  } catch {
    // jq failed in the shell: the file is left as it was
  }
}

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
