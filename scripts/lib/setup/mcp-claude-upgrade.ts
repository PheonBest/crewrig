// mcp-claude-upgrade.ts — rewrite of the Claude Code user-scope MCP registrations that still name
// the retired shell wrapper (spec 0266 R9, parent spec 0215 R15; slice 5b).
//
// `claude mcp add` is skipped for a name that is already registered, so a registration written by an
// earlier setup (`bash <repo>/scripts/lib/tls-exec.sh <command...>`) would otherwise survive for ever
// and fail with a missing-file error. For each framework-wrapped server the section reads
// `~/.claude.json`; a registration that is exactly the legacy shape (command `bash`, wrapper path
// first, no environment, no field beyond `type`) is removed and added again with the words of the
// current wrapper. A registration that is anything else is the operator's and stays. A second run
// finds the node form and writes nothing.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import type { JsonValue } from "../extension/types.ts";
import { rewriteLegacyArgv } from "../tls-exec/legacy.ts";
import type { Io, SetupCtx, Spawner } from "./context.ts";
import { trustWrapperPrefix } from "./trust-wrapper.ts";

/** The servers whose registration is a framework-wrapped command. */
export const WRAPPED_NAMES: readonly string[] = ["sequentialthinking", "mempalace", "playwright"];

type Ctx = Pick<SetupCtx, "home" | "repoDir" | "platform"> & { readonly io: Pick<Io, "out"> };

function userServers(home: string): Map<string, JsonValue> {
  const file = path.join(home, ".claude.json");
  try {
    const doc = parseJson(fs.readFileSync(file, "utf8"), file);
    const servers = doc instanceof Map ? doc.get("mcpServers") : undefined;
    return servers instanceof Map ? servers : new Map<string, JsonValue>();
  } catch {
    return new Map<string, JsonValue>();
  }
}

/** The legacy words of a registration that is exactly the legacy shape, else `undefined`. */
function legacyWords(entry: JsonValue | undefined): readonly string[] | undefined {
  if (!(entry instanceof Map)) return undefined;
  const env = entry.get("env");
  for (const key of entry.keys()) {
    if (key === "command" || key === "args") continue;
    if (key === "type" && entry.get("type") === "stdio") continue;
    if (key === "env" && env instanceof Map && env.size === 0) continue;
    return undefined;
  }
  const args = entry.get("args");
  const command = entry.get("command");
  if (!Array.isArray(args)) return undefined;
  return typeof command === "string" ? [command, ...args.map(String)] : undefined;
}

/** Returns the names rewritten, in order. */
export function upgradeLegacyClaudeEntries(
  ctx: Ctx,
  spawn: Spawner,
  io: Pick<Io, "out"> = ctx.io,
): readonly string[] {
  const servers = userServers(ctx.home);
  const prefix = trustWrapperPrefix({
    platform: ctx.platform,
    home: ctx.home,
    repoDir: ctx.repoDir,
  });
  const done: string[] = [];
  for (const name of WRAPPED_NAMES) {
    const old = legacyWords(servers.get(name));
    if (old === undefined) continue;
    const next = rewriteLegacyArgv(old[0], old.slice(1), prefix);
    if (next === undefined) continue;
    const add = (argv: readonly string[]): boolean =>
      spawn(["claude", "mcp", "add", "--scope", "user", name, "--", ...argv]).status === 0;
    spawn(["claude", "mcp", "remove", "--scope", "user", name]);
    if (add(next)) {
      io.out(`  ${name}: trust wrapper rewritten to the node form (scope=user)`);
      done.push(name);
      continue;
    }
    add(old);
    io.out(
      `  ${name}: FAILED to rewrite the trust wrapper — re-run manually: claude mcp add --scope user ${name} -- ${next.join(" ")}`,
    );
  }
  return done;
}
