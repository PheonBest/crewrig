// e2e-oracle-libs-ts-probes.ts — bindings of the probe library cases to their TypeScript twins.

import fs from "node:fs";
import path from "node:path";
import type { Binding, BindContext, BindResult } from "./e2e-oracle-libs-ts.ts";
import { REPO_ROOT } from "./e2e-oracle-libs-observe.ts";
import { resolveProbeA } from "../../../tests/e2e/lib/probe_a_resolve.ts";
import { resolveProbeBCell } from "../../../tests/e2e/lib/probe_b_resolve.ts";
import {
  resolveProbeC1,
  resolveProbeC2,
  resolveProbeC3,
  resolveProbeC4,
  resolveProbeCGuidance,
} from "../../../tests/e2e/lib/probe_c_resolve.ts";
import {
  copilotHomeMountOverride,
  stageCopilotEphemeralHome,
} from "../../../tests/e2e/lib/copilot_ephemeral_home.ts";

const LIB = "tests/e2e/lib";
const libFile = (name: string) => path.join(REPO_ROOT, LIB, name);

type Twin = (args: readonly string[], libPath: string) => BindResult;

const on =
  (name: string, twin: Twin): Binding =>
  (args) =>
    twin(args, libFile(name));

// Listing of the staged tree as `find . -printf '%p %y %m\n' | LC_ALL=C sort` printed it.
function listTree(root: string): string {
  const lines: string[] = [];
  const walk = (full: string, rel: string): void => {
    const st = fs.lstatSync(full);
    const type = st.isDirectory() ? "d" : st.isSymbolicLink() ? "l" : "f";
    lines.push(`${rel} ${type} ${(st.mode & 0o7777).toString(8)}`);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(full)) walk(path.join(full, name), `${rel}/${name}`);
    }
  };
  walk(root, ".");
  return lines
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((l) => `${l}\n`)
    .join("");
}

// The recorded cases pass a shell wrapper (`e2e_oracle_stage`) to `eval`. Its observable effects
// are reproduced here: the function result, then the staging root's name, tree and declaration
// copy, then the removal of the staging root.
const stageCase: Binding = (args: readonly string[], ctx: BindContext): BindResult => {
  const lines = (args[0] ?? "").trimEnd().split("\n");
  const call = (lines[lines.length - 1] ?? "").split(" ").slice(1);
  const res = stageCopilotEphemeralHome(
    call,
    ctx.env,
    ctx.work,
    libFile("copilot_ephemeral_home.sh"),
  );
  const staged = res.stdout.trimEnd();
  let out = `rc=${res.rc}\n`;
  if (staged === "") return { rc: res.rc, stdout: out, stderr: res.stderr };
  const name = path.basename(staged);
  out += `parent=${path.dirname(staged)}\n`;
  out += `name=crewrig-e2e-copilot-home.<RAND:${name.length}>\n`;
  out += listTree(staged);
  const decl = path.join(staged, "agents", `${call[1]}.md`);
  if (fs.existsSync(decl) && fs.statSync(decl).isFile()) {
    out += `decl=<${fs.readFileSync(decl, "utf8")}>\n`;
  }
  fs.rmSync(staged, { recursive: true, force: true });
  return { rc: 0, stdout: out, stderr: res.stderr };
};

export const bindings: Record<string, Binding> = {
  [`${LIB}/probe_a_resolve.sh#e2e_probe_a_resolve`]: on("probe_a_resolve.sh", resolveProbeA),
  [`${LIB}/probe_b_resolve.sh#e2e_probe_b_resolve_cell`]: on(
    "probe_b_resolve.sh",
    resolveProbeBCell,
  ),
  [`${LIB}/probe_c_resolve.sh#e2e_probe_c_resolve_c1`]: on("probe_c_resolve.sh", resolveProbeC1),
  [`${LIB}/probe_c_resolve.sh#e2e_probe_c_resolve_c2`]: on("probe_c_resolve.sh", resolveProbeC2),
  [`${LIB}/probe_c_resolve.sh#e2e_probe_c_resolve_c3`]: on("probe_c_resolve.sh", resolveProbeC3),
  [`${LIB}/probe_c_resolve.sh#e2e_probe_c_resolve_c4`]: on("probe_c_resolve.sh", resolveProbeC4),
  [`${LIB}/probe_c_resolve.sh#e2e_probe_c_resolve_guidance`]: on(
    "probe_c_resolve.sh",
    resolveProbeCGuidance,
  ),
  [`${LIB}/copilot_ephemeral_home.sh#e2e_copilot_home_mount_override`]: on(
    "copilot_ephemeral_home.sh",
    copilotHomeMountOverride,
  ),
  [`${LIB}/copilot_ephemeral_home.sh#e2e_stage_copilot_ephemeral_home`]: (args, ctx) =>
    stageCopilotEphemeralHome(args, ctx.env, ctx.work, libFile("copilot_ephemeral_home.sh")),
};

for (const id of [
  "bundle",
  "no-bundle",
  "decl-overrides-bundle-agent",
  "decl-missing",
  "mktemp-fails",
]) {
  bindings[`probes/home-stage-${id}`] = stageCase;
}
