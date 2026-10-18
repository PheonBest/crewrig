// e2e-literal-publisher.test.ts — `scripts/e2e/publish-probe-verdict.ts` against tuples recorded from
// the real shell script (issue #1693; provenance in lib/e2e-entry-golden.ts). `gh` is a stub that
// records its argv and the body file it was given; the dry-run, post, usage-error and missing-input
// paths are compared with the literal recording (status, streams, comment body, `gh` argv).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { runEntry, type EntryBox, type EntryCase } from "./lib/e2e-entry-diff.ts";
import { ENTRY_SKIP, assertRecorded, loadGolden } from "./lib/e2e-entry-golden.ts";

const FILE = "scripts/e2e/publish-probe-verdict";

const PROBE_A = `{
  "probe": "05-copilot-model-routing", "spec": "0194", "run_id": "test-1",
  "observed_at": "2026-09-02T00:00:00Z", "verdict": "BUG-PRESENT", "cli": "copilot",
  "cli_version": "1.0.7", "surface": ".claude/agents/", "layout": "nested (.claude/agents/<n>/AGENT.md)",
  "legs": {
    "control_no_hint": {"model_value": null, "nonce_observed": true, "evidence": "x"},
    "model_bearing": {"model_value": "sonnet", "nonce_observed": false, "evidence": "not found (HTTP 404)"}
  },
  "upstream_issue": "github/copilot-cli#4437"
}`;
const PROBE_B = `{
  "probe": "06-agent-surface-consumption", "spec": "0194",
  "run_id": "test-b-1", "observed_at": "2026-09-02T00:00:00Z",
  "cells": [
    {"cli": "copilot", "layout": ".claude/agents/ (nested)", "outcome": "not-consumed"},
    {"cell": "c2", "cli": "claude", "outcome": "consumed", "reason": "seen"},
    {"cell": "c3", "cli": "gemini", "outcome": "odd", "reason": null}
  ],
  "contradicts": ["specs/0143-copilot-subagent-model-fallback.md -> ## Intent", "second"]
}`;
const PROBE_B_EMPTY = `{"probe":"p","run_id":"r","observed_at":"t","cells":[],"contradicts":[]}`;
const MIXED = `{"probe":"p","run_id":7,"observed_at":null,"verdict":"V","cli":"c","cli_version":{"a":1},"cells":[{"cli":"x","layout":"l","outcome":"o"}]}`;

const GH_STUB = `#!/bin/sh
printf '%s\\n' "$@" | sed "s#$TMPDIR[^ ]*#<BODY>#" > "$PWD/gh-argv.txt"
while [ $# -gt 0 ]; do [ "$1" = "--body-file" ] && cp "$2" "$PWD/gh-body.txt"; shift; done
echo "https://github.com/x/y/issues/1#comment"
exit "\${GH_STUB_RC:-0}"
`;

const verdict = (text: string) => (box: EntryBox) => {
  fs.mkdirSync(path.join(box.work, "rep"), { recursive: true });
  fs.writeFileSync(path.join(box.work, "rep", "verdict.json"), text);
};

const rep = ["rep", "--issue", "1103"];
const cases: EntryCase[] = [
  { id: "pub/dry-a", file: FILE, args: [...rep, "--dry-run"], seed: verdict(PROBE_A) },
  { id: "pub/dry-b", file: FILE, args: [...rep, "--dry-run"], seed: verdict(PROBE_B) },
  { id: "pub/dry-b-empty", file: FILE, args: [...rep, "--dry-run"], seed: verdict(PROBE_B_EMPTY) },
  { id: "pub/dry-mixed", file: FILE, args: [...rep, "--dry-run"], seed: verdict(MIXED) },
  {
    id: "pub/dry-crlf",
    file: FILE,
    args: [...rep, "--dry-run"],
    seed: verdict(PROBE_B.replaceAll("\n", "\r\n")),
  },
  {
    id: "pub/dry-flags-first",
    file: FILE,
    args: ["--dry-run", "--issue", "5", "rep"],
    seed: verdict(PROBE_A),
  },
  { id: "pub/post-a", file: FILE, args: rep, seed: verdict(PROBE_A), stubTools: { gh: GH_STUB } },
  { id: "pub/post-b", file: FILE, args: rep, seed: verdict(PROBE_B), stubTools: { gh: GH_STUB } },
  {
    id: "pub/post-gh-fails",
    file: FILE,
    args: rep,
    seed: verdict(PROBE_A),
    stubTools: { gh: GH_STUB },
    env: { GH_STUB_RC: "4" },
  },
  { id: "pub/help", file: FILE, args: ["--help"] },
  { id: "pub/help-short", file: FILE, args: ["-h", "x"] },
  { id: "pub/no-args", file: FILE, args: [] },
  { id: "pub/no-issue", file: FILE, args: ["rep"] },
  { id: "pub/extra-arg", file: FILE, args: ["rep", "--issue", "1", "other"] },
  { id: "pub/no-dir", file: FILE, args: ["--issue", "1"] },
  { id: "pub/no-verdict", file: FILE, args: rep },
];

const golden = loadGolden("publisher");

describe("publish-probe-verdict.ts: recorded shell tuples", { skip: ENTRY_SKIP }, () => {
  for (const c of cases) it(c.id, () => assertRecorded(c, golden));
});

// Deviation (a) of spec 0261 R24: with an empty PATH the shell stops at `jq is required`, the twin
// needs no jq and reports the missing gh instead.
describe("publish-probe-verdict.ts: without gh", { skip: ENTRY_SKIP }, () => {
  it("reports the missing gh with status 1", () => {
    const c: EntryCase = {
      id: "pub/post-no-gh",
      file: FILE,
      args: rep,
      seed: verdict(PROBE_A),
      env: { PATH: "/nonexistent" },
    };
    const ts = runEntry(c, "entry");
    assert.ok(ts !== null);
    assert.equal(ts.rc, 1);
    assert.equal(
      ts.stderr,
      "ERROR: gh (GitHub CLI) is required to publish (drop --dry-run to skip).\n",
    );
    assert.equal(ts.stdout, "");
  });
});
