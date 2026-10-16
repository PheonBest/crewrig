// e2e-judge-run.ts — run one judge case through the unchanged shell judge against the HTTP
// stand-in (spec 0261 R9). Uses ASYNC spawn: a synchronous spawn would block the stand-in's event
// loop and the shell's curl would never get an answer.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createJudgeEndpoints } from "./e2e-judge-endpoints.ts";
import type { EndpointKey } from "./e2e-judge-endpoints.ts";
import { normalise } from "./e2e-normalise.ts";
import type { JudgeCase, JudgeTuple } from "./e2e-oracle-judge-types.ts";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface Run {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("latin1")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("latin1")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ rc: 127, stdout, stderr: stderr + String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ rc: code ?? 137, stdout, stderr });
    });
  });
}

export async function toolAvailable(bash: string): Promise<{ ok: boolean; reason: string }> {
  const v = await run(bash, ["-c", 'echo "${BASH_VERSINFO[0]}"']);
  if (Number(v.stdout.trim()) < 4)
    return { ok: false, reason: `bash >= 4 required (found ${v.stdout.trim()})` };
  for (const tool of ["curl", "jq", "openssl"]) {
    const r = await run(bash, ["-c", `command -v ${tool}`]);
    if (r.rc !== 0) return { ok: false, reason: `${tool} missing` };
  }
  return { ok: true, reason: "" };
}

function fill(text: string, map: Readonly<Record<string, string>>): string {
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(`{${k}}`).join(v);
  return out;
}

export async function runCase(c: JudgeCase, repoRoot: string, bash = "bash"): Promise<JudgeTuple> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-judge-"));
  const [home, report, work, bin] = ["home", "report", "work", "bin"].map((d) =>
    path.join(tmp, d),
  ) as [string, string, string, string];
  for (const d of [home, report, work, bin]) fs.mkdirSync(d, { recursive: true });
  const srv = createJudgeEndpoints();
  try {
    const base = await srv.start();
    for (const [key, replies] of Object.entries(c.responses))
      srv.queue(key as EndpointKey, replies ?? []);
    const key = c.seed?.some((s) => s.content.includes("{ED25519_KEY}"))
      ? (await run("openssl", ["genpkey", "-algorithm", "ed25519"])).stdout
      : "";
    const map = { BASE: base, HOME: home, REPORT: report, ED25519_KEY: key };
    fs.writeFileSync(
      path.join(report, "effective.json"),
      `${fill(JSON.stringify({ judge: c.effectiveJudge }), map)}\n`,
    );
    if (c.preCount !== undefined)
      fs.writeFileSync(path.join(report, "judge.count"), `${c.preCount}\n`);
    for (const s of c.seed ?? []) {
      const p = path.join(home, s.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, fill(s.content, map), { mode: s.mode });
      fs.chmodSync(p, s.mode);
    }
    const [promptFile, answerFile] = [path.join(work, "prompt"), path.join(work, "answer")];
    fs.writeFileSync(promptFile, c.args.prompt);
    fs.writeFileSync(answerFile, c.args.answer);
    const realCurl = (await run(bash, ["-c", "command -v curl"])).stdout.trim();
    fs.writeFileSync(
      path.join(bin, "curl"),
      `#!/usr/bin/env bash\nargs=()\nfor a in "$@"; do [[ "$a" == "${TOKEN_URL}" ]] && a="$E2E_JUDGE_TOKEN_REDIRECT"; args+=("$a"); done\nexec "${realCurl}" "\${args[@]}"\n`,
      { mode: 0o755 },
    );
    if (c.opensslFileShim === true) {
      // OpenSSL one-shot Ed25519 signing refuses a pipe ("unable to determine file size"): the
      // shim buffers stdin into a file. Recorded as a deviation of the environment, not the judge.
      const realOpenssl = (await run(bash, ["-c", "command -v openssl"])).stdout.trim();
      fs.writeFileSync(
        path.join(bin, "openssl"),
        `#!/usr/bin/env bash\nif [[ "$1" == pkeyutl && " $* " != *" -in "* ]]; then f="$(mktemp)"; cat > "$f"; "${realOpenssl}" "$@" -in "$f"; rc=$?; rm -f "$f"; exit $rc; fi\nexec "${realOpenssl}" "$@"\n`,
        { mode: 0o755 },
      );
    }
    const env: NodeJS.ProcessEnv = {
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      HOME: home,
      LANG: "C",
      LC_ALL: "C",
      TMPDIR: tmp,
      E2E_REPORT_DIR: report,
      E2E_JUDGE_TOKEN_REDIRECT: `${base}/gemini-token`,
      ...(c.strict === true ? { E2E_JUDGE_STRICT: "1" } : {}),
    };
    for (const [k, v] of Object.entries(c.env ?? {})) env[k] = fill(v, map);
    const res = await run(
      bash,
      [
        "-c",
        'set -uo pipefail; source tests/e2e/lib/llm_judge.sh; llm_judge "$@"',
        "judge",
        promptFile,
        answerFile,
        c.args.criterion,
      ],
      { cwd: repoRoot, env },
    );
    const ctx = { tmp, home, e2eHome: path.join(home, ".crewrig-e2e") };
    const files: Record<string, string> = {};
    for (const f of fs.readdirSync(report).sort())
      files[f] = normalise(fs.readFileSync(path.join(report, f), "utf8"), ctx);
    return {
      id: c.id,
      rc: res.rc,
      stdout: normalise(res.stdout, ctx).trimEnd(),
      // The drivers re-enable `set -x` themselves (`{ set -x; } 2>/dev/null` after each secret-bearing
      // step), so the shell's stderr carries xtrace lines whose order is racy and one of which holds a
      // signature. They are dropped: the oracle is the request shape and the verdict, not the trace.
      stderr: normalise(res.stderr, ctx)
        .split("\n")
        .filter((line) => !/^\++ /.test(line))
        .join("\n"),
      requests: srv.requests(),
      files,
    };
  } finally {
    await srv.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Violations of the case's declared expected shape; empty when the run matches. */
export function checkExpect(c: JudgeCase, t: JudgeTuple): string[] {
  const bad: string[] = [];
  const e = c.expect;
  if (t.rc !== e.rc) bad.push(`rc ${t.rc} != ${e.rc}`);
  if (t.stdout !== e.stdout)
    bad.push(`stdout ${JSON.stringify(t.stdout)} != ${JSON.stringify(e.stdout)}`);
  for (const s of e.stderrIncludes ?? [])
    if (!t.stderr.includes(s)) bad.push(`stderr lacks ${JSON.stringify(s)}`);
  if (t.requests.length !== e.requests) bad.push(`requests ${t.requests.length} != ${e.requests}`);
  if (e.count !== undefined && t.files["judge.count"] !== e.count)
    bad.push(`judge.count ${JSON.stringify(t.files["judge.count"])} != ${JSON.stringify(e.count)}`);
  if (t.requests.some((r) => r.unqueued)) bad.push("a request found the stand-in queue empty");
  return bad;
}
