// e2e-judge-ts.ts — run one judge case through the TypeScript twin (tests/e2e/lib/llm_judge.ts)
// in the same sandbox layout as the shell run of e2e-judge-run.ts (spec 0261 R9, PLAN v3 PR 5).
// The twin runs in-process against the HTTP stand-in; the Gemini token URL (hard-coded in the
// driver, like the shell's) is redirected to the stand-in by an injected `fetch`.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { llmJudge } from "../../../tests/e2e/lib/llm_judge.ts";
import { createJudgeEndpoints } from "./e2e-judge-endpoints.ts";
import type { EndpointKey } from "./e2e-judge-endpoints.ts";
import { TOKEN_URL } from "./e2e-judge-run.ts";
import { normalise } from "./e2e-normalise.ts";
import type { JudgeCase, JudgeTuple } from "./e2e-oracle-judge-types.ts";

function fill(text: string, map: Readonly<Record<string, string>>): string {
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** What a shell run writes through a latin1-decoded pipe: UTF-8 bytes read back as latin1. */
const asShellBytes = (s: string): string => Buffer.from(s, "utf8").toString("latin1");

export async function runCaseTs(c: JudgeCase): Promise<JudgeTuple> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-judge-ts-"));
  const [home, report, work] = ["home", "report", "work"].map((d) => path.join(tmp, d)) as [
    string,
    string,
    string,
  ];
  for (const d of [home, report, work]) fs.mkdirSync(d, { recursive: true });
  const srv = createJudgeEndpoints();
  try {
    const base = await srv.start();
    for (const [key, replies] of Object.entries(c.responses))
      srv.queue(key as EndpointKey, replies ?? []);
    const key = c.seed?.some((s) => s.content.includes("{ED25519_KEY}"))
      ? crypto
          .generateKeyPairSync("ed25519")
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString()
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
    const env: Record<string, string | undefined> = {
      HOME: home,
      LANG: "C",
      LC_ALL: "C",
      TMPDIR: tmp,
      E2E_REPORT_DIR: report,
      E2E_LIB_DIR: "tests/e2e/lib",
      ...(c.strict === true ? { E2E_JUDGE_STRICT: "1" } : {}),
    };
    for (const [k, v] of Object.entries(c.env ?? {})) env[k] = fill(v, map);
    const redirect: typeof fetch = (input, init) =>
      fetch(
        typeof input === "string" && input === TOKEN_URL ? `${base}/gemini-token` : input,
        init,
      );
    const res = await llmJudge(
      { env, now: () => Date.now(), sleep: () => Promise.resolve(), fetch: redirect },
      promptFile,
      answerFile,
      c.args.criterion,
    );
    const ctx = { tmp, home, e2eHome: path.join(home, ".crewrig-e2e") };
    const files: Record<string, string> = {};
    for (const f of fs.readdirSync(report).sort())
      files[f] = normalise(fs.readFileSync(path.join(report, f), "utf8"), ctx);
    return {
      id: c.id,
      rc: res.status,
      stdout: normalise(asShellBytes(res.stdout), ctx).trimEnd(),
      stderr: normalise(asShellBytes(res.stderr), ctx),
      requests: srv.requests(),
      files,
    };
  } finally {
    await srv.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
