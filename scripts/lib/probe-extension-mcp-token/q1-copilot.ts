// q1-copilot.ts — Q1: does a plugin-root token expand inside `command`, and does a bare relative
// command resolve via Copilot's own cwd default? Three installs into an isolated HOME.

import fs from "node:fs";

import { captureUsageFile } from "./usage-adapter.ts";
import {
  captureStdoutOnly,
  launchInstant,
  line,
  mustRun,
  nonEmpty,
  onPath,
  prefixLines,
  runQuiet,
  runToFile,
  section,
  writeStub,
  type Ctx,
} from "./io.ts";

const FORMS = [
  "${PLUGIN_ROOT}/dist/stub.sh",
  "${COPILOT_PLUGIN_ROOT}/dist/stub.sh",
  "dist/stub.sh",
];
const LABELS = ["PLUGIN_ROOT", "COPILOT_PLUGIN_ROOT", "bare-relative-cwd-default"];
const PLUGIN = "crewrig-probe-plugin";

export function probeQ1Copilot(ctx: Ctx): void {
  section(ctx, "Q1 — Copilot CLI: token expansion inside command (isolated HOME)");
  if (!onPath(ctx, "copilot")) {
    line(ctx, "SKIP: copilot not on PATH");
    ctx.failed = true;
    return;
  }
  if (!onPath(ctx, "gh")) {
    line(ctx, "SKIP: gh not on PATH (needed for a non-interactive Copilot token)");
    ctx.failed = true;
    return;
  }
  const ghToken = captureStdoutOnly(ctx, "gh", ["auth", "token"]);
  if (ghToken === "") {
    line(
      ctx,
      "SKIP: 'gh auth token' produced nothing — Copilot needs GH_TOKEN for a non-interactive session.",
    );
    ctx.failed = true;
    return;
  }

  const pluginDir = `${ctx.work}/copilot-plugin`;
  const log = `${ctx.work}/copilot-invocation.log`;
  fs.mkdirSync(`${pluginDir}/dist`, { recursive: true });
  fs.writeFileSync(
    `${pluginDir}/plugin.json`,
    '{"name":"crewrig-probe-plugin","version":"1.0.0","description":"crewrig spec 0180 probe — safe to delete"}\n',
  );
  writeStub(`${pluginDir}/dist/stub.sh`, log);

  const home = `${ctx.work}/copilot-home`;
  fs.mkdirSync(`${home}/.copilot`, { recursive: true });
  const isolated = { ...ctx.env, HOME: home };

  for (let i = 0; i < 3; i++) {
    const cmd = FORMS[i] as string;
    const label = LABELS[i] as string;
    runQuiet(ctx, "copilot", ["plugin", "uninstall", PLUGIN], { env: isolated });
    fs.writeFileSync(
      `${pluginDir}/.mcp.json`,
      `{"mcpServers":{"probe-args":{"type":"stdio","command":"${cmd}","args":["variant-${i}"]}}}\n`,
    );
    mustRun(ctx, "copilot", ["plugin", "install", pluginDir], { env: isolated });
    fs.rmSync(log, { force: true });
    const sessOut = `${ctx.work}/copilot-session-${i}.log`;
    const usageOut = `${ctx.work}/copilot-usage-${i}.json`;
    const instant = launchInstant();
    runToFile(
      ctx,
      "copilot",
      [
        "-p",
        "reply with the single word OK and call no tools",
        "--allow-all-tools",
        "--no-color",
        "--usage-output-file",
        usageOut,
      ],
      sessOut,
      { env: { ...isolated, GH_TOKEN: ghToken }, timeoutMs: 60_000 },
    );
    captureUsageFile("copilot-cli", usageOut, instant, ctx.env, ctx.cwd);
    if (nonEmpty(log)) {
      line(ctx, `  form='${label}' (${cmd})  ->  SPAWNED`);
      ctx.out(prefixLines(fs.readFileSync(log, "utf8"), "    "));
    } else {
      line(ctx, `  form='${label}' (${cmd})  ->  NOT SPAWNED — session output:`);
      ctx.out(prefixLines(fs.readFileSync(sessOut, "utf8"), "    "));
      ctx.failed = true;
    }
  }
  runQuiet(ctx, "copilot", ["plugin", "uninstall", PLUGIN], { env: isolated });
}
