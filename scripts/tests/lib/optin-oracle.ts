// optin-oracle.ts — the test-owned oracle of the usage-capture opt-in suites (spec 0263, row J1b,
// port of the `JQ_DEFS` jq programs of test-setup-usage-capture-optin.sh). Written independently of
// scripts/lib/hook-recognition.ts and scripts/lib/setup/usage-capture-state.ts on purpose: it
// re-implements the capture predicate as a regexp over the same grammar and the legacy spaced
// Gemini form with fs.statSync, so a defect in the implementation cannot hide in its own oracle.
// The shared recognition corpus checks it (usage-capture-optin-fragments.test.ts, G32).
//
// STABLE API (the other usage-capture-optin-*.test.ts files import it; do not rename):
//   type Json                                    parsed JSON value
//   type OptinCli = "claude" | "gemini" | "copilot"
//   OPTIN_CLIS: readonly OptinCli[]              the three CLIs, in suite order
//   cliEvents(cli): string[]                     the R5 events, in declaration order
//   sortedEvents(cli): string                    the R5 events sorted and space-joined
//   cliTag(cli): string                          claude-code | gemini-cli | copilot-cli
//   expectedCmd(cli, event, scriptPath): string  `node "<p>" <tag> <ev>` for .ts, `bash "<p>" ...` else
//   legacyCmd(cli, event, scriptPath): string    the coupled command (Gemini: unquoted path)
//   homeConfig(cli, home): string                the file each setup's capture block targets
//   nonR5Event(cli): string                      an event the fragment never registers
//   isCmd(h), isC1(h), isCapture(h): boolean     the predicate (isCapture adds the legacy form)
//   legacyPath(h): string | null                 the path of the legacy spaced Gemini form
//   handlers(cfg): Handler[]                     flatten grouped and flat shapes: {e, s?, h}
//   captureCount(cfg, ev): number                capture handlers on one event
//   captureCmds(cfg, ev): string[]               their commands
//   captureEvents(cfg): string                   sorted unique events carrying capture, space-joined
//   totalCapture(cfg): number
//   noncaptureView(cfg): string                  canonical key-sorted JSON of everything capture does not own
//   stripCaptureNoPrune(cfg): Json               cfg minus its capture handlers, containers kept
//   canonical(v): string                         key-sorted JSON (array order significant, like `jq -cS`)
//   jsonEq(fileA, fileB): boolean                both parse and canonical forms are equal
//   readJson(file): Json                         parse a file (throws on error)
//   operatorHandlers(cfg), sessionRecordingHandlers(cfg): string   canonical sorted handler lists
//   fileMode(file): number                       fs.statSync(file).mode & 0o777
//   backups(cfg): string[]                       sibling files named `<cfg>.bak.*`

import fs from "node:fs";
import path from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type OptinCli = "claude" | "gemini" | "copilot";
export interface Handler {
  readonly e: string;
  readonly s?: Json;
  readonly h: Json;
}

export const OPTIN_CLIS: readonly OptinCli[] = ["claude", "gemini", "copilot"];

const EVENTS: Record<OptinCli, string[]> = {
  claude: ["Stop", "SessionEnd"],
  gemini: ["AfterModel"],
  copilot: ["agentStop", "sessionEnd"],
};
const TAGS: Record<OptinCli, string> = {
  claude: "claude-code",
  gemini: "gemini-cli",
  copilot: "copilot-cli",
};
const NON_R5: Record<OptinCli, string> = {
  claude: "PreToolUse",
  gemini: "BeforeTool",
  copilot: "postToolUse",
};

export const cliEvents = (cli: OptinCli): string[] => [...EVENTS[cli]];
export const sortedEvents = (cli: OptinCli): string => [...EVENTS[cli]].sort().join(" ");
export const cliTag = (cli: OptinCli): string => TAGS[cli];
export const nonR5Event = (cli: OptinCli): string => NON_R5[cli];

export function expectedCmd(cli: OptinCli, event: string, script: string): string {
  const shell = script.endsWith(".ts") ? "node" : "bash";
  return `${shell} "${script}" ${TAGS[cli]} ${event}`;
}
export function legacyCmd(cli: OptinCli, event: string, script: string): string {
  return cli === "gemini" ? `bash ${script} gemini-cli ${event}` : expectedCmd(cli, event, script);
}
export function homeConfig(cli: OptinCli, home: string): string {
  if (cli === "claude") return path.join(home, ".claude", "settings.json");
  if (cli === "gemini") return path.join(home, ".gemini", "settings.json");
  return path.join(home, ".copilot", "hooks", "copilot-transcript-hooks.json");
}

export function isObj(v: Json | undefined): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isCmd(h: Json | undefined): boolean {
  if (!isObj(h)) return false;
  const type = h["type"];
  return (
    (type === undefined || type === null || type === "command") && typeof h["command"] === "string"
  );
}

const C1 =
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:\S*\/)?env\s+)?(?:(?:\S*\/)?(?:bash|sh|node)\s+)?(?:"[^"]*\/hooks\/usage-capture\.(?:sh|ts)"|'[^']*\/hooks\/usage-capture\.(?:sh|ts)'|[^\s"']*\/hooks\/usage-capture\.(?:sh|ts))\s+(?:claude-code|gemini-cli|copilot-cli)\s+[A-Za-z]+\s*$/;
// eslint-disable-next-line no-control-regex
const LEGACY =
  /^bash (\/[^\x00-\x1f\x7f"';&|<>()$`\\*?[\]{}#~]*\/hooks\/usage-capture\.sh) gemini-cli AfterModel$/;

const command = (h: Json | undefined): string =>
  isObj(h) && typeof h["command"] === "string" ? h["command"] : "";
export const isC1 = (h: Json | undefined): boolean => isCmd(h) && C1.test(command(h));

export function legacyPath(h: Json | undefined): string | null {
  if (!isCmd(h)) return null;
  return LEGACY.exec(command(h))?.[1] ?? null;
}
function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
export function isCapture(h: Json | undefined): boolean {
  if (isC1(h)) return true;
  const p = legacyPath(h);
  return p !== null && isFile(p);
}

export function handlers(cfg: Json): Handler[] {
  const out: Handler[] = [];
  const hooks = isObj(cfg) ? cfg["hooks"] : undefined;
  if (!isObj(hooks)) return out;
  for (const [e, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (isObj(item) && "hooks" in item) {
        const { hooks: inner, ...s } = item;
        if (Array.isArray(inner)) for (const h of inner) out.push({ e, s, h });
      } else out.push({ e, h: item });
    }
  }
  return out;
}

const onEvent = (cfg: Json, ev: string): Handler[] =>
  handlers(cfg).filter((x) => x.e === ev && isCapture(x.h));
export const captureCount = (cfg: Json, ev: string): number => onEvent(cfg, ev).length;
export const captureCmds = (cfg: Json, ev: string): string[] =>
  onEvent(cfg, ev).map((x) => command(x.h));
export const totalCapture = (cfg: Json): number =>
  handlers(cfg).filter((x) => isCapture(x.h)).length;
export function captureEvents(cfg: Json): string {
  const evs = handlers(cfg)
    .filter((x) => isCapture(x.h))
    .map((x) => x.e);
  return [...new Set(evs)].sort().join(" ");
}

export function canonical(v: Json | undefined): string {
  const sort = (x: Json | undefined): Json | undefined => {
    if (Array.isArray(x)) return x.map((y) => sort(y) ?? null);
    if (isObj(x)) {
      const o: { [key: string]: Json } = {};
      for (const k of Object.keys(x).sort()) o[k] = sort(x[k]) ?? null;
      return o;
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

export function stripCaptureNoPrune(cfg: Json): Json {
  if (!isObj(cfg) || !isObj(cfg["hooks"])) return cfg;
  const hooks: { [key: string]: Json } = {};
  for (const [e, list] of Object.entries(cfg["hooks"])) {
    hooks[e] = Array.isArray(list)
      ? list
          .map((item): Json => {
            if (isObj(item) && Array.isArray(item["hooks"])) {
              return { ...item, hooks: item["hooks"].filter((h) => !isCapture(h)) };
            }
            return item;
          })
          .filter((item) => !(isObj(item) && !("hooks" in item) && isCapture(item)))
      : (list ?? null);
  }
  return { ...cfg, hooks };
}

export function noncaptureView(cfg: Json): string {
  const all = handlers(cfg).filter((x) => !isCapture(x.h));
  const rest = isObj(cfg)
    ? Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== "hooks"))
    : {};
  const hooks = [...new Set(all.map((x) => x.e))].sort().map((e) => ({
    e,
    hs: all.filter((x) => x.e === e).map(({ s, h }) => (s === undefined ? { h } : { s, h })),
  }));
  return canonical({ rest, hooks } as Json);
}

export const readJson = (file: string): Json => JSON.parse(fs.readFileSync(file, "utf8")) as Json;
export function jsonEq(a: string, b: string): boolean {
  try {
    return canonical(readJson(a)) === canonical(readJson(b));
  } catch {
    return false;
  }
}
const list = (cfg: Json, keep: (x: Handler) => boolean): string =>
  canonical(
    handlers(cfg)
      .filter(keep)
      .map(({ e, s, h }): Json => (s === undefined ? { e, h } : { e, s, h }))
      .map((x) => canonical(x))
      .sort() as Json,
  );
const operatorCmd = (x: Handler): boolean => command(x.h).startsWith("/opt/operator/");
export const operatorHandlers = (cfg: Json): string => list(cfg, operatorCmd);
export const sessionRecordingHandlers = (cfg: Json): string =>
  list(cfg, (x) => !(operatorCmd(x) || isCapture(x.h)));

export const fileMode = (file: string): number => fs.statSync(file).mode & 0o777;
export function backups(cfg: string): string[] {
  const base = `${path.basename(cfg)}.bak.`;
  return fs
    .readdirSync(path.dirname(cfg))
    .filter((f) => f.startsWith(base))
    .map((f) => path.join(path.dirname(cfg), f));
}
