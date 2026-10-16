// usage-attribution-mutations.test.ts — STATIC, MUT1-MUT7 and DOCS of test-usage-attribution.sh
// (spec 0260; Bash L954-1234 and L1327-1348). Every mutation edits a TEMP COPY of the usage
// libraries (never a tracked file), runs the original probe against it and, as a strengthening,
// runs the same probe on the unmutated checkout to prove it is green there. A missing marker
// throws. The two #1260 EXIT-trap cases are dropped (Bash-only, listed in the spec); the
// "#1260 mutation helper" test below replaces them.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { applyMutation, type MutationCopy } from "./lib/mutation-copy.ts";
import {
  attributionCopy,
  copyCase,
  PRUNE_CLI,
  PRUNE_PERIOD,
  registerTestStore,
  resolve,
  seedPrune,
  specFile,
  submit,
  withMutant,
} from "./lib/usage-attribution-prune-rig.ts";
import {
  buildCheckout,
  type Case,
  cli,
  driver,
  fixture,
  journalPath,
  newCase,
  realTmp,
  rollupFig,
  walkFiles,
} from "./lib/usage-attribution-rig.ts";
import { cleanupAll, REPO } from "./lib/worktree-fixtures.ts";

const LIB = "scripts/lib/usage-store/";
const CAP = "scripts/lib/usage-capture/";
const MUTATED = [
  `${LIB}journal.js`,
  `${CAP}attribution.js`,
  `${LIB}checkout.js`,
  `${LIB}prune.js`,
  `${LIB}rollup.js`,
  `${LIB}query.js`,
  `${LIB}layout.js`,
];
const sha = (file: string): string =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(REPO, file)))
    .digest("hex");
const before = new Map(MUTATED.map((f) => [f, sha(f)]));
const GITHUB = "git@github.com:crewrig/crewrig.git";
const noGit = realTmp("usage-attr-nogit-");

describe("usage attribution mutations", () => {
  after(() => cleanupAll());

  test("MUT1 skipping the .attr.json link stores the entry with no sidecar", () => {
    const probe = (c: Case) => {
      const s = submit(c, "r25-ch2-env", { ATTR_CTX_ENV_CREWRIG_TASK: "mut1-key" });
      return fs.existsSync(journalPath(c.root, s.cli, s.period, s.recordId, ".attr"));
    };
    assert.equal(probe(newCase()), true, "control: the unmutated store writes the sidecar");
    const sidecar = withMutant(
      `${LIB}journal.js`,
      "if (meta !== undefined) {",
      "if (false && meta !== undefined) {",
      (_copy, c) => probe(c),
    );
    assert.equal(sidecar, false, "MUT1 not red: the sidecar was still written");
  });

  test("MUT2 resolver consulting channel 2 after a malformed channel 1 leaks the env key", () => {
    const probe = (c: Case) => {
      driver(c, [
        "declaration-write",
        JSON.stringify({
          taskHandoffKey: "has a space",
          declaringChannel: "explicit",
          sessionId: "attr-malformed-session",
        }),
      ]);
      return resolve(c, "r25-malformed-ch1.json", noGit, {
        ATTR_CTX_ENV_CREWRIG_TASK: "valid-env-key",
      });
    };
    assert.ok(!probe(newCase()).includes("valid-env-key"), "control: no leak when unmutated");
    const out = withMutant(
      `${CAP}attribution.js`,
      "if (candidate !== null) {\n      return validateCandidate(candidate);\n    }",
      "if (candidate !== null) {\n      const validated = validateCandidate(candidate);\n      if (validated.outcome === 'unattributed') continue; // MUTATION-2\n      return validated;\n    }",
      (_copy, c) => probe(c),
    );
    assert.ok(out.includes("valid-env-key"), `MUT2 not red: ${out}`);
  });

  test("MUT3 dropping the spec-file lookup regresses feat/0203 to 203 (marker must exist)", () => {
    const probe = (c: Case) => {
      const dir = path.join(realTmp("usage-attr-syn-"), "branch-iv");
      buildCheckout(dir, "feat/0203-probe-c-guidance-surface");
      specFile(dir, "0203-probe-c-guidance-surface", 1113, "0203", "probe-c-guidance-surface");
      return resolve(c, "r25-branch-iv.json", dir);
    };
    assert.match(probe(newCase()), /"taskHandoffKey":"1113"/, "control: 1113 when unmutated");
    const out = withMutant(
      `${CAP}attribution.js`,
      String.raw`const specShape = branch.match(/^([a-z]+)\/(\d{4})-([a-z0-9][a-z0-9-]*?)(?:-delta-(\d{2}))?$/);`,
      "const specShape = null; // MUTATION-3: drop the spec-file lookup entirely",
      (_copy, c) => probe(c),
    );
    assert.ok(out.includes('"taskHandoffKey":"203"'), `MUT3 not red: ${out}`);
    assert.throws(
      () => withMutant(`${CAP}attribution.js`, "const specShape = NO SUCH MARKER;", "x", () => 0),
      /mutation needle absent/,
      "a missing exact-source marker must fail",
    );
  });

  test("MUT4 checkoutRootFor without the upward walk loses the forge-issue asset", () => {
    const probe = (c: Case) => {
      const dir = path.join(realTmp("usage-attr-syn-"), "branch-iii");
      buildCheckout(dir, "fix/0900-subdir-case", GITHUB);
      const sub = path.join(dir, "a", "b");
      fs.mkdirSync(sub, { recursive: true });
      return resolve(c, "r25-branch-iii.json", sub, { ATTR_PROJECT_ROOT_OVERRIDE: sub });
    };
    assert.match(probe(newCase()), /forge-issue/, "control: asset derived when unmutated");
    const out = withMutant(
      `${LIB}checkout.js`,
      "if (memo.has(real)) return memo.get(real);",
      "if (memo.has(real)) return memo.get(real);\n  return real; // MUTATION-4: no upward walk",
      (_copy, c) => probe(c),
    );
    assert.ok(
      out.includes('"outcome":"unattributed"') || !out.includes("forge-issue"),
      `MUT4 not red: ${out}`,
    );
  });

  describe("MUT5 prune arms", () => {
    const run = (needle: RegExp, replacement: string) =>
      withMutant(
        `${LIB}prune.js`,
        needle,
        replacement,
        (copy, c) => {
          const seed = seedPrune(c, noGit, "MUTATION-5 probe");
          const out = cli(c, "prune", [PRUNE_CLI, PRUNE_PERIOD, "--force"], copy.root);
          assert.equal(out.status, 0, out.stderr);
          return {
            report: out.stdout + out.stderr,
            ledger: walkFiles(path.join(c.root, "ledger")),
            partition: fs.existsSync(seed.partition),
          };
        },
        registerTestStore,
      );

    test("MUT5a skipping the period arm leaves the attribution-ledger unreported and intact", () => {
      const r = run(
        /if \(store\.scope === (["'])period\1\) \{\n      dir = store\.dirFor\(per\);/,
        "if (store.scope === $1period$1 && false) { // MUTATION-5a\n      dir = store.dirFor(per);",
      );
      assert.ok(!/attribution-ledger/i.test(r.report), r.report);
      assert.ok(r.ledger.length > 0, "ledger entries were removed despite the skipped arm");
    });

    test("MUT5b skipping the cli-period arm leaves test-store unreported, partition intact", () => {
      const r = run(
        /\} else if \(store\.scope === (["'])cli-period\1\) \{\n      dir = store\.dirFor\(cli, per\);/,
        "} else if (store.scope === $1cli-period$1 && false) { // MUTATION-5b\n      dir = store.dirFor(cli, per);",
      );
      assert.ok(!/test-store/i.test(r.report), r.report);
      assert.ok(r.partition, "test-store partition was removed despite the skipped arm");
    });
  });

  test("MUT6 summing the session-cumulative snapshots gives 6000 instead of 3000", () => {
    const files = [
      "r27-per-request-1",
      "r27-per-request-2",
      "r27-run-total-1",
      "r27-session-cumulative-1",
      "r27-session-cumulative-2",
      "r27-session-cumulative-3",
      "r27-uncaptured-1",
    ];
    const args = ["--task-key", "attr-r27-task", "--rollup"];
    const seed = (c: Case) =>
      files.forEach((f) => submit(c, f, { ATTR_CTX_ENV_CREWRIG_TASK: "attr-r27-task" }));
    const control = newCase();
    seed(control);
    assert.equal(rollupFig(cli(control, "query", args).stdout, "session-cumulative"), 3000);
    const got = withMutant(
      `${LIB}rollup.js`,
      /(["'])session-cumulative\1: lastSnapshots\(captured\),/,
      "$1session-cumulative$1: captured.filter((r) => r.fidelity === $1session-cumulative$1), // MUTATION-6",
      (copy, c) => {
        seed(c);
        return rollupFig(cli(c, "query", args, copy.root).stdout, "session-cumulative");
      },
    );
    assert.equal(got, 6000, "MUT6 not red");
  });

  test("MUT7 a fidelity-only admit ignores --task-key: 2026-05 d01-task-a regresses to 500", () => {
    const may = ["--period", "2026-05", "--task-key", "d01-task-a", "--rollup"];
    const seed = (c: Case) => {
      for (const f of [
        "d01-session-a-sc-1",
        "d01-session-a-sc-2",
        "d01-session-a-sc-3",
        "d01-session-b-sc-1",
        "d01-session-b-sc-2",
        "d01-session-d-per-request",
        "d01-session-d-uncaptured",
      ]) {
        submit(c, f);
      }
      for (const f of ["d01-session-c-sc-1", "d01-session-c-sc-2"]) {
        submit(c, f, { ATTR_CTX_ENV_CREWRIG_TASK: "d01-task-a" });
      }
      const add = cli(c, "attribute", [
        "add",
        "--period",
        "2026-06",
        "--task-key",
        "d01-task-b",
        "--reason",
        "usage-attribution suite: delta-01 moves every 2026-06 record to d01-task-b",
        "--author",
        "test-suite",
      ]);
      assert.equal(add.status, 0, add.stderr);
    };
    const control = newCase();
    seed(control);
    assert.equal(rollupFig(cli(control, "query", may).stdout, "session-cumulative"), 400);
    const got = withMutant(
      `${LIB}query.js`,
      "    admit: selectionPredicate(opts),",
      "    admit: (r) => !opts.fidelity || r.fidelity === opts.fidelity, // MUTATION-7",
      (copy, c) => {
        seed(c);
        return rollupFig(cli(c, "query", may, copy.root).stdout, "session-cumulative");
      },
    );
    assert.equal(got, 500, "MUT7 not red: expected the regression to 500, not 400");
  });

  test("#1260 mutation helper never touches the tracked tree and a missing marker fails", () => {
    const copy = attributionCopy();
    try {
      assert.ok(!copy.root.startsWith(REPO), "mutation copy lives inside the checkout");
      assert.throws(() => applyMutation(copy, `${LIB}query.js`, "NO SUCH MARKER", "x"), /absent/);
    } finally {
      copy.dispose();
    }
    for (const f of MUTATED) assert.equal(sha(f), before.get(f), `${f} was modified`);
  });

  test("STATIC-29 the attribution libraries are pure (no subprocess, no network)", () => {
    const re = /child_process|execSync|spawnSync|fetch\(|https?:\/\//;
    for (const rel of [`${CAP}attribution.js`, `${LIB}checkout.js`, `${LIB}declaration.js`]) {
      const hits = fs
        .readFileSync(path.join(REPO, rel), "utf8")
        .split("\n")
        .flatMap((line, i) => (re.test(line) ? [`${rel}:${i + 1}:${line}`] : []));
      assert.deepEqual(hits, [], `no-network/no-subprocess hit: ${hits.join(" | ")}`);
    }
  });

  test("DOCS-39 every scripts/ path named in docs/usage-attribution.md exists", () => {
    // The Bash suite named itself in no doc; the property (no dangling scripts/ token) is asserted.
    const doc = fs.readFileSync(path.join(REPO, "docs", "usage-attribution.md"), "utf8");
    const tokens = new Set(
      (doc.match(/scripts\/[A-Za-z0-9_./-]+/g) ?? []).map((t) => t.replace(/[.,)`]+$/, "")),
    );
    const missing = [...tokens].filter((t) => t !== "" && !fs.existsSync(path.join(REPO, t)));
    assert.deepEqual(missing, [], `docs/usage-attribution.md names missing paths: ${missing}`);
  });
});
