// optin-fixtures.ts — fixture and process helpers of the usage-capture opt-in suites (spec 0263,
// row J1b). Companion of optin-oracle.ts; shared by every usage-capture-optin-*.test.ts file.
//
// STABLE API (do not rename):
//   REPO, FIX_DIR, CORPUS                       repository root, scripts/tests/fixtures/setup-usage-capture, recognition corpus
//   HOOKS_ABS                                   fs.realpathSync of hooks/ (the `pwd -P` equivalent)
//   CAPTURE_ABS, CAPTURE_SH_ABS, GUARD_ABS      <HOOKS_ABS>/usage-capture.ts | usage-capture.sh | worktree-git-guard.sh
//   ENV_PATCH                                   { MEMPALACE_TRANSCRIPT_ENABLED: "1" }
//   interface Scratch { home, usageRoot, tmp, env, cleanup() }
//   scratch(): Scratch                          fs.mkdtempSync root; HOME, USERPROFILE and CREWRIG_USAGE_ROOT point into it;
//                                               `env` is cleanEnv() plus those three; umask is not touched
//   runOptin(sub, args, { env, cwd, result?, platform? }): { status, stdout, stderr }
//                                               node scripts/usage-capture-optin.ts [--platform p] sub [--result f] -- args
//   resultFlags(file): { SR_TRANSCRIPT_WIRED?, SR_ALL_HOOKS_DISABLED? }   parse the `--result` side channel
//   materialize(fixture, dest, home, cap?): void   copy of a fixture with __CAPTURE_ABS__ (default CAPTURE_SH_ABS),
//                                               __HOOK_TARGET__ (<home>/.<cli>/hooks/mempalace-transcript.sh) and
//                                               __GUARD_ABS__ substituted; never in place
//   patchedManifest(cli, dest, home): void      coupled fixture minus capture handlers (and `.env` for claude)
//   mergeSr(s, cli, cfg, manifest): RunResult   merge-session-recording-hooks (claude gets ENV_PATCH)
//   addCmds(cfg, cli, script, form?): void      register the R5 capture commands in cfg (grouped or flat shape)
//   initCfg(cli): Json                          a minimal config of the CLI's shape with empty `hooks`
//   emptyGroups(cfg): number                    count of grouped entries with an empty `hooks` array
//   fixtureNames(): string[]                    the *.json files of FIX_DIR (callers assert a floor)
//   declOf(cli): { facts: Map<string,string>, steps: string[] }   the setup declaration; throws when vacuous
//   stepNo(decl, id): number                    1-based position of a step, 0 when absent

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  type Json,
  type OptinCli,
  isObj,
  cliEvents,
  cliTag,
  expectedCmd,
  legacyCmd,
  stripCaptureNoPrune,
  readJson,
} from "./optin-oracle.ts";
import { SETUP_DESCRIPTORS } from "./print-setup-declarations.ts";
import { declarationFacts } from "./setup-declarations-facts.ts";
import { ENTRY } from "./usage-entry-rig.ts";
import { cleanEnv, REPO } from "./worktree-fixtures.ts";

export { REPO };
export const FIX_DIR = path.join(REPO, "scripts", "tests", "fixtures", "setup-usage-capture");
export const CORPUS = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-capture",
  "recognition-corpus.json",
);
export const HOOKS_ABS = fs.realpathSync(path.join(REPO, "hooks"));
export const CAPTURE_ABS = path.join(HOOKS_ABS, "usage-capture.ts");
export const CAPTURE_SH_ABS = path.join(HOOKS_ABS, "usage-capture.sh");
export const GUARD_ABS = path.join(HOOKS_ABS, "worktree-git-guard.sh");
export const ENV_PATCH = { MEMPALACE_TRANSCRIPT_ENABLED: "1" } as const;

export interface Scratch {
  readonly home: string;
  readonly usageRoot: string;
  readonly tmp: string;
  readonly env: NodeJS.ProcessEnv;
  cleanup(): void;
}
export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function scratch(): Scratch {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "uc-optin-")));
  const home = path.join(tmp, "home");
  const usageRoot = path.join(tmp, "usage");
  fs.mkdirSync(home, { recursive: true });
  const env = cleanEnv({
    HOME: home,
    USERPROFILE: home,
    CREWRIG_USAGE_ROOT: usageRoot,
    CI: undefined,
  });
  return {
    home,
    usageRoot,
    tmp,
    env,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

export interface RunOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly result?: string;
  readonly platform?: string;
}
export function runOptin(sub: string, args: readonly string[], o: RunOptions): RunResult {
  const argv = [ENTRY, ...(o.platform ? ["--platform", o.platform] : []), sub];
  if (o.result) argv.push("--result", o.result);
  const r = spawnSync(process.execPath, [...argv, "--", ...args], {
    encoding: "utf8",
    env: o.env,
    cwd: o.cwd ?? REPO,
    input: "",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function resultFlags(file: string): Record<string, "0" | "1"> {
  const out: Record<string, "0" | "1"> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^(SR_TRANSCRIPT_WIRED|SR_ALL_HOOKS_DISABLED)=([01])$/.exec(line);
    if (m?.[1] && (m[2] === "0" || m[2] === "1")) out[m[1]] = m[2];
  }
  return out;
}

function subst(v: Json, map: readonly (readonly [string, string])[]): Json {
  if (typeof v === "string") return map.reduce((s, [a, b]) => s.split(a).join(b), v);
  if (Array.isArray(v)) return v.map((x) => subst(x, map));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x, map)]));
  return v;
}
export function materialize(
  fixture: string,
  dest: string,
  home: string,
  cap: string = CAPTURE_SH_ABS,
): void {
  const cli = fixture.split("-")[0] ?? "";
  const doc = subst(readJson(path.join(FIX_DIR, fixture)), [
    ["__CAPTURE_ABS__", cap],
    ["__HOOK_TARGET__", path.join(home, `.${cli}`, "hooks", "mempalace-transcript.sh")],
    ["__GUARD_ABS__", GUARD_ABS],
  ]);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(doc, null, 2)}\n`);
}

export function patchedManifest(cli: OptinCli, dest: string, home: string): void {
  const tmp = `${dest}.pm.json`;
  materialize(`${cli}-coupled.json`, tmp, home);
  const doc = stripCaptureNoPrune(readJson(tmp));
  if (isObj(doc)) delete doc["env"];
  fs.writeFileSync(dest, `${JSON.stringify(doc, null, 2)}\n`);
  fs.rmSync(tmp, { force: true });
}

export function mergeSr(
  s: Scratch,
  cli: OptinCli,
  cfg: string,
  manifest: string,
  result?: string,
): RunResult {
  const extra = cli === "claude" ? [JSON.stringify(ENV_PATCH)] : [];
  return runOptin("merge-session-recording-hooks", [cli, cfg, manifest, ...extra], {
    env: s.env,
    ...(result ? { result } : {}),
  });
}

export function addCmds(
  cfg: Json,
  cli: OptinCli,
  script: string,
  form: "quoted" | "legacy" = "quoted",
): void {
  if (!isObj(cfg)) throw new Error("addCmds: cfg must be an object");
  const hooks: { [key: string]: Json } = isObj(cfg["hooks"]) ? cfg["hooks"] : {};
  cfg["hooks"] = hooks;
  for (const ev of cliEvents(cli)) {
    const command = (form === "legacy" ? legacyCmd : expectedCmd)(cli, ev, script);
    const handler: Json = { type: "command", command };
    const cur = hooks[ev];
    const entry: Json = cli === "copilot" ? handler : { hooks: [handler] };
    hooks[ev] = Array.isArray(cur) ? [...cur, entry] : [entry];
  }
}
export function initCfg(cli: OptinCli): Json {
  return cli === "copilot" ? { version: 1, hooks: {} } : { hooks: {} };
}
export function emptyGroups(cfg: Json): number {
  const hooks = isObj(cfg) ? cfg["hooks"] : undefined;
  if (!isObj(hooks)) return 0;
  let n = 0;
  for (const list of Object.values(hooks)) {
    if (Array.isArray(list))
      n += list.filter(
        (x) => isObj(x) && Array.isArray(x["hooks"]) && x["hooks"].length === 0,
      ).length;
  }
  return n;
}
export const fixtureNames = (): string[] =>
  fs
    .readdirSync(FIX_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

export function declOf(cli: OptinCli): { facts: Map<string, string>; steps: string[] } {
  const d = SETUP_DESCRIPTORS[cli];
  if (d === undefined) throw new Error(`no descriptor for ${cli}`);
  const facts = new Map(declarationFacts(d));
  if (facts.size === 0) throw new Error(`${cli}: the declaration is vacuous`);
  return { facts, steps: [...d.steps] };
}
export const stepNo = (decl: { steps: string[] }, id: string): number => decl.steps.indexOf(id) + 1;
export { cliTag };
