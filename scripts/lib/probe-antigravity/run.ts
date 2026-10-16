// run.ts — the probe itself (twin of scripts/probe-antigravity-discovery.sh). Environment and
// working directory are parameters; the only side effects are the HOME sentinels (always removed
// in a finally) and the two output streams.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findOnPath } from "../../../tests/e2e/lib/exec.ts";
import { runBounded, TIMED_OUT } from "./bounded.ts";
import { classify, countListed } from "./classify.ts";
import {
  Created,
  DUP_NAME,
  DUP_PATHS,
  exists,
  SENTINELS,
  SKILL_CONTROL,
  writeAgentSentinel,
  writeSkillSentinel,
} from "./sentinels.ts";
import { rewriteResponse } from "./usage-adapter.ts";

export interface ProbeIO {
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const EXIT_PRECONDITION = 1;
const EXIT_INDETERMINATE = 3;

function forcedPrompt(kind: string, names: string): string {
  return [
    "For each name listed below, output exactly one line of the form NAME=YES or",
    "NAME=NO, where YES means that " + kind + " is available to you in this session and NO",
    "means it is not. Emit one line for EVERY name, in the order given. Output",
    "nothing else — no prose, no preamble, no code fences.",
    "",
    names,
  ]
    .join("\n")
    .replace(/\n+$/, "");
}

/** Runs the probe and resolves to its exit status. */
export async function runProbe(io: ProbeIO): Promise<number> {
  const { env } = io;
  const agy = env.AGY_BIN ?? "agy";
  const timeoutRaw = env.AGY_PROBE_TIMEOUT ?? "300";
  const shape = env.AGY_PROBE_ASK_SHAPE ?? "captured";
  const home = env.HOME ?? "";
  const timeoutSec = Number(timeoutRaw);

  if (findOnPath(agy, env) === null) {
    io.err(`ERROR: '${agy}' not found in PATH. This probe needs the vendor binary.\n`);
    return EXIT_PRECONDITION;
  }

  const bar = "==========================================================\n";
  io.out(
    `${bar}  Antigravity discovery probe (spec 0123 R13/R14)\n  binary: ${agy}   bound: ${timeoutRaw}s   shape: ${shape}\n${bar}\n`,
  );

  const collisions: string[] = [];
  for (const rel of [...SENTINELS.map((x) => x.rel), ...DUP_PATHS]) {
    if (exists(path.join(home, rel))) collisions.push(`${home}/${rel}`);
  }
  if (collisions.length > 0) {
    io.err(
      "ERROR: sentinel paths already exist — refusing to run, and refusing to\n" +
        "       remove anything this probe did not write:\n" +
        collisions.map((c) => `  - ${c}\n`).join(""),
    );
    return EXIT_PRECONDITION;
  }

  const created = new Created();
  try {
    return await probeBody(io, { agy, shape, home, timeoutSec }, created);
  } finally {
    created.cleanup();
  }
}

interface Params {
  readonly agy: string;
  readonly shape: string;
  readonly home: string;
  readonly timeoutSec: number;
}

async function probeBody(io: ProbeIO, p: Params, created: Created): Promise<number> {
  const { env, cwd } = io;
  io.out("Installing sentinels...\n");
  for (const x of SENTINELS) {
    const target = `${p.home}/${x.rel}`;
    if (x.kind === "skill") writeSkillSentinel(target, x.name, p.home, created);
    else writeAgentSentinel(target, x.name, x.name, p.home, created);
    created.paths.push(target);
    io.out(`  ${x.name}  (${x.label})\n`);
  }
  for (const rel of DUP_PATHS) {
    const target = `${p.home}/${rel}`;
    writeAgentSentinel(target, DUP_NAME, rel, p.home, created);
    created.paths.push(target);
    io.out(`  ${DUP_NAME}  (duplicate-name cell -> ${rel})\n`);
  }
  io.out("\n");

  const work = fs.mkdtempSync(path.join(env.TMPDIR ?? os.tmpdir(), "probe-agy."));
  created.paths.push(work);

  const bounded = { env, cwd, timeoutSec: p.timeoutSec };

  // One model call; resolves to its answer text (shape-adjusted) and its status.
  const ask = async (dest: string, prompt: string): Promise<string> => {
    const out = path.join(work, "ask.out");
    const launch = new Date().toISOString().slice(0, 19) + ".000Z";
    const st = await runBounded(out, p.agy, ["-p", prompt, "--output-format", "json"], bounded);
    rewriteResponse(out, launch, env);
    const size = fs.statSync(out).size;
    const status = st === TIMED_OUT ? "TIMEOUT" : size === 0 ? "EMPTY" : "OK";
    const raw = fs.readFileSync(out);
    fs.rmSync(out, { force: true });
    if (p.shape === "direct") fs.writeFileSync(dest, raw);
    else fs.writeFileSync(dest, raw.toString("utf8").replace(/\n+$/, "") + "\n");
    return status;
  };
  const show = (file: string): void => {
    io.out(fs.readFileSync(file, "utf8"));
  };

  const skillNames = SENTINELS.filter((x) => x.kind === "skill").map((x) => x.name);
  const agentNames = [...SENTINELS.filter((x) => x.kind === "agent").map((x) => x.name), DUP_NAME];
  const listOf = (names: readonly string[]): string => names.map((n) => `${n}\n`).join("");

  io.out("--- Open listing: skills ---\n");
  const skillsOpen = path.join(work, "skills-open.txt");
  const skillsOpenStatus = await ask(
    skillsOpen,
    "List the names of every skill available to you in this session, one per line, and nothing else.",
  );
  show(skillsOpen);
  io.out(`(status: ${skillsOpenStatus})\n\n`);

  io.out("--- Open listing: agents (deterministic, no model call) ---\n");
  const agentsOpen = path.join(work, "agents-open.txt");
  let agentsOpenStatus = "OK";
  if ((await runBounded(agentsOpen, p.agy, ["agents"], bounded)) !== 0)
    agentsOpenStatus = "TIMEOUT";
  if (fs.statSync(agentsOpen).size === 0) agentsOpenStatus = "EMPTY";
  show(agentsOpen);
  io.out(`(status: ${agentsOpenStatus})\n\n`);

  io.out("--- Forced choice: skills ---\n");
  const skillsForced = path.join(work, "skills-forced.txt");
  const skillsStatus = await ask(
    skillsForced,
    forcedPrompt("skill", listOf(skillNames) + SKILL_CONTROL),
  );
  show(skillsForced);
  io.out(`(status: ${skillsStatus})\n\n`);

  io.out("--- Forced choice: agents ---\n");
  const agentsForced = path.join(work, "agents-forced.txt");
  const agentsStatus = await ask(agentsForced, forcedPrompt("agent", listOf(agentNames)));
  show(agentsForced);
  io.out(`(status: ${agentsStatus})\n\n`);

  io.out(
    `${"=".repeat(58)}\n  Verdicts (R14: FOUND / NOT-FOUND / INDETERMINATE)\n${"=".repeat(58)}\n`,
  );
  const skillsText = fs.readFileSync(skillsForced, "utf8");
  const agentsText = fs.readFileSync(agentsForced, "utf8");
  let indeterminate = 0;
  for (const x of SENTINELS) {
    const v =
      x.kind === "skill"
        ? classify(skillsText, skillsStatus, x.name)
        : classify(agentsText, agentsStatus, x.name);
    if (v === "INDETERMINATE") indeterminate++;
    io.out(`  ${v.padEnd(14)} ${x.name}  (${x.label})\n`);
  }
  const dupVerdict = classify(agentsText, agentsStatus, DUP_NAME);
  if (dupVerdict === "INDETERMINATE") indeterminate++;
  const listed = countListed(fs.readFileSync(agentsOpen, "utf8"), DUP_NAME);
  io.out(
    `  ${dupVerdict.padEnd(14)} ${DUP_NAME}  (duplicate name at ${DUP_PATHS.length} roots; listed ${listed} time(s) by \`${p.agy} agents\`)\n\n`,
  );
  io.out(
    "  Duplicate-name reading: listed 2 = doubled; 1 = de-duplicated (one copy\n" +
      "  shadows the other); 0 = refused or not discovered. The unique-named\n" +
      "  siblings at the SAME two roots are the control — if they are FOUND and\n" +
      "  the duplicate is listed once, the de-duplication is unambiguous.\n\n",
  );
  io.out(
    `  Positive control (${SKILL_CONTROL}): ${classify(skillsText, skillsStatus, SKILL_CONTROL)}\n` +
      "  A control that is not FOUND means the MODEL failed, not the placement.\n\n" +
      "Record the table in docs/runbooks/antigravity-discovery-probe.md, stamped\n" +
      `with the \`${p.agy}\` version and the date.\n`,
  );

  if (indeterminate > 0) {
    io.err(
      `\nINDETERMINATE: ${indeterminate} sentinel(s) got no usable answer. This is NOT\n` +
        "an absence — re-run before recording anything (R14).\n",
    );
    return EXIT_INDETERMINATE;
  }
  return 0;
}
