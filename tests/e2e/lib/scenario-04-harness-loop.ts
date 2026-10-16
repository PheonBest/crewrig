// scenario-04-harness-loop.ts — scenario 04 (pillar 4, harness loop): a friction drawer is mined
// into wing=harness-friction (harness-report simulation), a curator-style search reads it back, and
// the LLM judge rates the friction body. Twin of tests/e2e/scenarios/04-harness-loop/run.sh.

import fs from "node:fs";

import { assertFileExists } from "./assert.ts";
import { llmJudge } from "./llm_judge.ts";
import {
  MEMPALACE_IMAGE,
  runSidecarScenario,
  type SidecarScenario,
} from "./scenario-02-sidecar.ts";
import type { Env } from "./scenario.ts";
import { assertStdoutMatches } from "./structural.ts";

/** `$(cat file)`: the content without its trailing line feeds. */
function cat(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\n+$/, "");
}

async function body(s: SidecarScenario): Promise<void> {
  const { ctx } = s;
  const mount = `${s.volume}:/home/agent/.mempalace`;
  const dir = ctx.reportDir;
  const frictionBody = cat(`${ctx.scenarioDir}/friction.prompt`);
  const frictionContent =
    `[FRICTION] e2e-04-build-version-drop | silent drop of metadata.provenance.version\n\n` +
    `writer_agent: ${ctx.cli}-harness-report\ncomponent: scripts/build-components.sh\n` +
    `visible_to: ["*"]\nsymptom: build exits 0 even though metadata.provenance.version was dropped on rename\n` +
    `expected: explicit "version field missing" diagnostic; non-zero exit\n\n---\n${frictionBody}`;

  const workspace = `${dir}/friction-workspace`;
  fs.mkdirSync(`${workspace}/frictions`, { recursive: true });
  fs.writeFileSync(`${workspace}/frictions/friction-01.txt`, `${frictionContent}\n`);

  const reported = s.docker(
    [
      "run",
      "--rm",
      "-v",
      mount,
      "-v",
      `${workspace}:/tmp/harness-ws`,
      MEMPALACE_IMAGE,
      "bash",
      "-c",
      "mempalace init --yes /tmp/harness-ws &&\n         mempalace mine /tmp/harness-ws --wing harness-friction",
    ],
    { stdoutFile: `${dir}/report.stdout`, stderrFile: `${dir}/report.stderr` },
  );
  if (reported !== 0) s.emit("not_ok", "harness-report: drawer write exited non-zero");
  else s.emit("ok", "harness-report: friction drawer written");

  const curatorOut = `${dir}/curator.stdout`;
  const searched = s.docker(
    [
      "run",
      "--rm",
      "-v",
      mount,
      MEMPALACE_IMAGE,
      "mempalace",
      "search",
      "[FRICTION]",
      "--wing",
      "harness-friction",
      "--room",
      "frictions",
      "--results",
      "5",
    ],
    { stdoutFile: curatorOut, stderrFile: `${dir}/curator.stderr` },
  );
  if (searched !== 0) s.emit("not_ok", "harness-curator: search exited non-zero");
  else s.emit("ok", "harness-curator: search returned");

  const o = { cwd: ctx.scenarioDir, env: s.toolEnv };
  s.check(
    assertFileExists(curatorOut, o),
    "side-effect: curator stdout captured",
    "side-effect: curator stdout missing",
  );
  s.check(
    assertStdoutMatches("\\[FRICTION\\]", curatorOut, "", o),
    "structural: [FRICTION] marker present in curator output",
    "structural: [FRICTION] marker absent in curator output",
  );

  const subject = `${dir}/judge-subject.txt`;
  fs.writeFileSync(subject, `${frictionBody}\n`);
  const criterion = cat(`${ctx.scenarioDir}/judge-criterion.txt`);
  const judged = await llmJudge(
    { env: ctx.env, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    `${ctx.scenarioDir}/friction.prompt`,
    subject,
    criterion,
  );
  fs.appendFileSync(`${dir}/judge.log`, judged.stdout + judged.stderr);
  if (judged.status === 0) s.emit("ok", "llm-judge: friction summary coherent");
  else s.emit("not_ok", "llm-judge: friction summary incoherent");
}

export function runScenario04(env: Env) {
  return runSidecarScenario("04-harness-loop/run.ts", "04-harness-loop", "-harness", env, body);
}
