// setup-session-recording.test.ts — the render and the merge of the session-recording opt-in
// (spec 0256 requirements 30 and 31; plan v2 step B3a.4). The Bash oracle went with
// scripts/lib/usage-capture-optin.sh (spec 0266); each case asserts the TypeScript outcome.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import type { HooksCtx } from "../lib/setup/hooks-rewrite.ts";
import {
  claudeEnvPatch,
  mergeSessionRecordingHooks,
  renderSessionRecordingManifest,
} from "../lib/setup/session-recording.ts";
import {
  configOf,
  directCmd,
  legacyForms,
  homeWithCopies,
  HOME_DIR,
  makeTranscriptCheckout,
  NEIGHBOURS,
  transcriptCommands,
  WIRED,
  writeConfig,
  type TranscriptCheckout,
  type WiredCli,
} from "./lib/transcript-fixtures.ts";
import { cleanupAll, read, realTmp, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const SKIP = SKIP_POSIX || (which("jq") === null ? "SKIP: jq is needed" : false);
const OK: SpawnResult = { status: 0, stdout: "", stderr: "" };
const floorOk: Spawner = () => OK;

interface Run {
  readonly ctx: HooksCtx;
  readonly out: string[];
  readonly err: string[];
}
function runCtx(repo: string): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  return { ctx: { io, env: {}, platform: process.platform, home: repo, repoDir: repo }, out, err };
}

const norm = (text: string, file: string): string =>
  text
    .split(file)
    .join("<F>")
    .replace(/\.bak\.\d{8}-\d{6}(\.\d\d)?/g, ".bak.<T>")
    .trimEnd();
const lines = (text: string): string[] => (text === "" ? [] : text.split("\n"));
const mode = (file: string): number => fs.statSync(file).mode & 0o777;

interface Outcome {
  readonly file: string;
  readonly wired: boolean;
  readonly disabled: boolean;
  readonly ok: boolean;
  readonly out: string[];
  readonly err: string[];
}

function tsLeg(cli: WiredCli, co: TranscriptCheckout, file: string, python = ""): Outcome {
  const run = runCtx(co.repo);
  const rendered = renderSessionRecordingManifest({
    ctx: run.ctx,
    cli,
    manifestSrc: co.manifest(cli),
    spawn: floorOk,
  });
  assert.ok(rendered !== null);
  const wired = rendered.transcriptWired;
  const envPatch = cli === "claude" ? claudeEnvPatch(wired, python).patch : {};
  const merged = mergeSessionRecordingHooks({
    ctx: run.ctx,
    cli,
    config: file,
    patched: rendered.manifest,
    envPatch: wired ? envPatch : {},
    patchedLabel: "<M>",
  });
  return {
    file,
    ok: merged.ok,
    wired,
    disabled: merged.allHooksDisabled,
    out: lines(norm(run.out.join("\n"), file)),
    err: lines(norm(run.err.join("\n"), file)),
  };
}

/** The merge over `config` (null: no file): it succeeds, the file is written with owner-only access. */
function merged(cli: WiredCli, config: unknown | null, python = ""): Outcome {
  const co = makeTranscriptCheckout();
  const b = path.join(path.dirname(co.repo), "b", `${cli}.json`);
  fs.mkdirSync(path.dirname(b), { recursive: true });
  if (config !== null) {
    fs.writeFileSync(b, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
  }
  const ts = tsLeg(cli, co, b, python);
  assert.ok(ts.ok, "status");
  assert.ok(ts.wired, "wired");
  assert.equal(mode(b), 0o600);
  return ts;
}

describe("the merge", { skip: SKIP }, () => {
  for (const cli of WIRED) {
    test(`${cli}: own commands of every class, an operator hook, the guard and a capture command`, () => {
      const co = makeTranscriptCheckout();
      const forms = legacyForms(homeWithCopies(), HOME_DIR[cli]);
      const config = configOf(
        cli,
        [forms["legacy-enabled"] ?? "", forms["legacy-unmarked"] ?? ""],
        {
          neighbours: [...NEIGHBOURS(co, cli), "/opt/operator/notify.sh"],
          env: { KEEP: "1" },
        },
      );
      merged(cli, config, "/usr/bin/python3");
    });
    test(`${cli}: a foreign-prefix command stays alone on its event and is reported`, () => {
      const forms = legacyForms(homeWithCopies(), HOME_DIR[cli]);
      merged(cli, configOf(cli, [forms["legacy-enabled"] ?? "", forms["foreign-prefix"] ?? ""]));
    });
    test(`${cli}: an absent file is created at 0600 from the manifest`, () => {
      merged(cli, null);
    });
    test(`${cli}: a second run changes nothing`, () => {
      const co = makeTranscriptCheckout();
      const file = writeConfig(co, `${cli}.json`, configOf(cli, [directCmd(co, cli)]));
      const first = tsLeg(cli, co, file);
      const before = JSON.parse(read(file)) as unknown;
      const second = tsLeg(cli, co, file);
      assert.ok(first.ok && second.ok);
      assert.deepEqual(JSON.parse(read(file)), before);
      assert.equal(mode(file), 0o600);
    });
  }
  test("copilot: a kept disableAllHooks true is reported and flagged", () => {
    merged("copilot", { version: 1, disableAllHooks: true, hooks: {} });
    const co = makeTranscriptCheckout();
    const file = writeConfig(co, "off.json", { disableAllHooks: true, hooks: {} });
    const out = tsLeg("copilot", co, file);
    assert.equal(out.disabled, true);
    assert.match(out.err.join("\n"), /keeps "disableAllHooks": true/);
  });
  test("a configuration that is not a JSON object is refused and left as it is", () => {
    const co = makeTranscriptCheckout();
    const file = path.join(path.dirname(co.repo), "bad.json");
    fs.writeFileSync(file, "[1]\n");
    const run = runCtx(co.repo);
    const merged = mergeSessionRecordingHooks({
      ctx: run.ctx,
      cli: "claude",
      config: file,
      patched: {},
    });
    assert.equal(merged.ok, false);
    assert.equal(read(file), "[1]\n");
    assert.match(
      run.err.join("\n"),
      /is not readable as JSON; session-recording hooks not merged\./,
    );
  });
});

describe("render below the floor or without the script", () => {
  const FLOOR_LINE = "crewrig: Node.js v20.0.0 detected; crewrig requires Node.js >= 24.";
  const below: Spawner = () => ({ status: 1, stdout: "", stderr: `${FLOOR_LINE}\n` });

  for (const cli of WIRED) {
    test(`${cli}: below the floor the manifest carries neither the guard nor the transcript`, () => {
      const co = makeTranscriptCheckout();
      const run = runCtx(co.repo);
      const out = renderSessionRecordingManifest({
        ctx: run.ctx,
        cli,
        manifestSrc: co.manifest(cli),
        spawn: below,
      });
      assert.ok(out !== null);
      assert.equal(out.transcriptWired, false);
      assert.ok(!JSON.stringify(out.manifest).includes("mempalace-transcript"));
      assert.ok(!JSON.stringify(out.manifest).includes("worktree-git-guard"));
      assert.equal(run.err[0], FLOOR_LINE);
      assert.match(
        run.err.join("\n"),
        /not wired this run; installed commands are left as they are\./,
      );
    });
    test(`${cli}: a rendered manifest holds direct commands and is wired`, () => {
      const co = makeTranscriptCheckout();
      const out = renderSessionRecordingManifest({
        ctx: runCtx(co.repo).ctx,
        cli,
        manifestSrc: co.manifest(cli),
        spawn: floorOk,
      });
      assert.ok(out !== null && out.transcriptWired && out.guardWired);
      assert.ok(transcriptCommands(out.manifest).includes(directCmd(co, cli)));
    });
  }
  test("a missing transcript script leaves the transcript out and the guard in", () => {
    const co = makeTranscriptCheckout("co", { entry: false });
    const run = runCtx(co.repo);
    const out = renderSessionRecordingManifest({
      ctx: run.ctx,
      cli: "claude",
      manifestSrc: co.manifest("claude"),
      spawn: floorOk,
    });
    assert.ok(out !== null && !out.transcriptWired && out.guardWired);
    assert.match(
      run.err.join("\n"),
      /transcript hook not found at .*; no session-recording command/,
    );
  });
  test("a missing manifest yields null", () => {
    const co = makeTranscriptCheckout();
    const out = renderSessionRecordingManifest({
      ctx: runCtx(co.repo).ctx,
      cli: "claude",
      manifestSrc: path.join(realTmp("sr-none-"), "nope.json"),
      spawn: floorOk,
    });
    assert.equal(out, null);
  });
});

describe("the Claude Code environment patch", () => {
  test("only when wired, MEMPALACE_PYTHON only when set; the printed text", () => {
    assert.deepEqual(claudeEnvPatch(false, "/py"), { patch: {}, text: "{}" });
    assert.deepEqual(claudeEnvPatch(true, ""), {
      patch: { MEMPALACE_TRANSCRIPT_ENABLED: "1" },
      text: '{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}',
    });
    assert.equal(
      claudeEnvPatch(true, "/py").text,
      '{"MEMPALACE_TRANSCRIPT_ENABLED":"1","MEMPALACE_PYTHON":"/py"}',
    );
  });
});
