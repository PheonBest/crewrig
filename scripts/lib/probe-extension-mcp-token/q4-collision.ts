// q4-collision.ts — Q4: how Claude and Copilot resolve a name collision between a plugin-declared MCP
// server and one declared at user scope. Gemini and Antigravity are citations, not probed here.

import fs from "node:fs";

import {
  captureMerged,
  line,
  mustRun,
  onPath,
  prefixLines,
  runQuiet,
  section,
  type Ctx,
} from "./io.ts";

export function probeQ4Claude(ctx: Ctx): void {
  section(ctx, "Q4 (Claude) — extension-declared vs user-scope name collision");
  if (!onPath(ctx, "claude")) {
    line(ctx, "SKIP: claude not on PATH");
    ctx.failed = true;
    return;
  }
  const pluginDir = `${ctx.work}/claude-plugin`;
  const home = `${ctx.work}/claude-home`;
  fs.mkdirSync(`${pluginDir}/.claude-plugin`, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    `${pluginDir}/.claude-plugin/plugin.json`,
    '{"name": "crewrig-probe-plugin", "description": "probe", "version": "1.0.0"}\n',
  );
  fs.writeFileSync(
    `${pluginDir}/.mcp.json`,
    '{"mcpServers":{"probe-args":{"command":"echo","args":["plugin-scope"]}}}\n',
  );
  const env = { ...ctx.env, HOME: home };
  mustRun(
    ctx,
    "claude",
    ["mcp", "add", "--scope", "user", "probe-args", "--", "echo", "user-scope-command"],
    { env },
  );

  const out = captureMerged(ctx, "claude", ["--plugin-dir", pluginDir, "mcp", "list"], {
    env,
    timeoutMs: 120_000,
  });
  ctx.out(prefixLines(`${out}\n`, "  "));
  const lines = out.split("\n");
  if (
    lines.some((l) => l.startsWith("plugin:crewrig-probe-plugin:probe-args:")) &&
    lines.some((l) => /^probe-args:/.test(l))
  ) {
    line(
      ctx,
      "  VERDICT: Claude NAMESPACES the plugin server as plugin:<pluginName>:<serverName> — it never collides",
    );
    line(
      ctx,
      "           with a same-named user/project-scope entry; both remain independently addressable.",
    );
  } else {
    line(
      ctx,
      "  INCONCLUSIVE: expected both a namespaced 'plugin:...' line and a bare 'probe-args:' line.",
    );
    ctx.failed = true;
  }
}

export function probeQ4Copilot(ctx: Ctx): void {
  section(ctx, "Q4 (Copilot) — extension-declared vs user-scope name collision");
  if (!onPath(ctx, "copilot")) {
    line(ctx, "SKIP: copilot not on PATH");
    ctx.failed = true;
    return;
  }
  const pluginDir = `${ctx.work}/copilot-plugin-q4`;
  const home = `${ctx.work}/copilot-home-q4`;
  fs.mkdirSync(`${pluginDir}/dist`, { recursive: true });
  fs.mkdirSync(`${home}/.copilot`, { recursive: true });
  fs.writeFileSync(
    `${pluginDir}/plugin.json`,
    '{"name":"crewrig-probe-plugin-q4","version":"1.0.0","description":"probe"}\n',
  );
  fs.writeFileSync(
    `${pluginDir}/.mcp.json`,
    '{"mcpServers":{"probe-args":{"type":"stdio","command":"echo","args":["plugin-scope"]}}}\n',
  );
  const env = { ...ctx.env, HOME: home };
  mustRun(ctx, "copilot", ["plugin", "install", pluginDir], { env });
  runQuiet(ctx, "copilot", ["mcp", "add", "probe-args", "--", "echo", "user-scope-command"], {
    env,
  });

  const out = captureMerged(ctx, "copilot", ["mcp", "get", "probe-args", "--json"], {
    env,
    timeoutMs: 120_000,
  });
  ctx.out(prefixLines(`${out}\n`, "  "));
  if (out.includes('"source": "plugin"')) {
    line(ctx, "  VERDICT: Copilot resolves the collision in favour of the PLUGIN-sourced entry —");
    line(ctx, "           the user-scope declaration is shadowed, not merged and not an error.");
  } else if (out.includes('"source": "user"')) {
    line(ctx, "  VERDICT: Copilot resolves the collision in favour of the USER-scope entry.");
  } else {
    line(ctx, "  INCONCLUSIVE: could not determine which entry won.");
    ctx.failed = true;
  }
  runQuiet(ctx, "copilot", ["plugin", "uninstall", "crewrig-probe-plugin-q4"], { env });
}
