// governance-tee-selftest.test.ts — oracle mutation proof of the governance differential
// harness (spec 0259 R26): a tiny stand-in pair (shell script + TypeScript entry) in a minimal
// sandbox must be replayed when both legs agree and rejected (exit 99) when they differ in
// stdout, stderr, exit status or (mutating cases) the resulting file tree; statusOnly ignores
// the output channels. Also pins the sandbox contract. POSIX only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  installTee,
  makeSandbox,
  runScript,
  TEE_PATH,
  type Sandbox,
  type TeeCase,
} from "./lib/governance-sandbox.ts";

const skip = process.platform === "win32" ? "POSIX only" : false;
const boxes: Sandbox[] = [];
after(() => boxes.forEach((b) => b.dispose()));

/** A TS entry that writes `out` to stdout, `err` to stderr and exits with `code`. */
function tsEntry(out: string, err: string, code: number, extra = ""): string {
  return `${extra}process.stdout.write(${JSON.stringify(out)});\nprocess.stderr.write(${JSON.stringify(err)});\nprocess.exitCode = ${code};\n`;
}

function shEntry(out: string, err: string, code: number, extra = ""): string {
  return `#!/usr/bin/env bash\n${extra}printf '%s' ${JSON.stringify(out)}\nprintf '%b' ${JSON.stringify(err)} >&2\nexit ${code}\n`;
}

interface Legs {
  readonly out: string;
  readonly err: string;
  readonly code: number;
  readonly shExtra?: string;
  readonly tsExtra?: string;
}

function standIn(sh: Legs, ts: Legs, flags: Omit<TeeCase, "name"> = {}): Sandbox {
  const box = makeSandbox({
    minimal: true,
    copyFromRepo: [TEE_PATH],
    files: {
      "scripts/probe.sh": shEntry(sh.out, sh.err, sh.code, sh.shExtra),
      "scripts/probe.ts": tsEntry(ts.out, ts.err, ts.code, ts.tsExtra),
    },
  });
  boxes.push(box);
  fs.chmodSync(path.join(box.root, "scripts/probe.sh"), 0o755);
  installTee(box, "probe", flags);
  return box;
}

const same: Legs = { out: "hello", err: "warn", code: 3 };

describe("governance tee oracle mutation", { skip }, () => {
  test("agreeing legs are replayed verbatim", () => {
    const r = runScript(standIn(same, same), "probe");
    assert.deepEqual([r.status, r.stdout, r.stderr], [3, "hello", "warn"]);
  });

  test("the shell original is kept byte for byte beside the stub", () => {
    const box = standIn(same, same);
    assert.equal(
      fs.readFileSync(path.join(box.root, "scripts/probe.sh.shell"), "utf8"),
      shEntry("hello", "warn", 3),
    );
    assert.match(
      fs.readFileSync(path.join(box.root, "scripts/probe.sh"), "utf8"),
      /exec node .*governance-tee\.ts/,
    );
  });

  test("differing stdout exits 99", () => {
    assert.equal(runScript(standIn(same, { ...same, out: "other" }), "probe").status, 99);
  });

  test("differing stderr alone exits 99", () => {
    const r = runScript(standIn(same, { ...same, err: "other" }), "probe");
    assert.equal(r.status, 99);
    assert.match(r.stderr, /stderr differs/);
  });

  test("differing exit status alone exits 99", () => {
    const r = runScript(standIn(same, { ...same, code: 4 }), "probe");
    assert.equal(r.status, 99);
    assert.match(r.stderr, /exit status: shell 3, typescript 4/);
  });

  test("a mutating case detects a differing file tree", () => {
    const shW = "echo a > out.txt\n";
    const tsW = 'import fs from "node:fs";\nfs.writeFileSync("out.txt", "b\\n");\n';
    const r = runScript(
      standIn({ ...same, shExtra: shW }, { ...same, tsExtra: tsW }, { mutating: true }),
      "probe",
    );
    assert.equal(r.status, 99);
    assert.match(r.stderr, /file trees differ: out\.txt/);
  });

  test("a mutating case with equal writes passes, and leg (b) never touches the real tree", () => {
    const shW = "echo a > out.txt\n";
    const tsW = 'import fs from "node:fs";\nfs.writeFileSync("out.txt", "a\\n");\n';
    const box = standIn({ ...same, shExtra: shW }, { ...same, tsExtra: tsW }, { mutating: true });
    const r = runScript(box, "probe");
    assert.equal(r.status, 3);
    assert.equal(fs.readFileSync(path.join(box.root, "out.txt"), "utf8"), "a\n");
  });

  test("a copied scripts/ directory runs its own copy of the tee, not the outer one", () => {
    const outer = standIn(same, same);
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "gov-copy-"));
    try {
      fs.cpSync(path.join(outer.root, "scripts"), path.join(copy, "scripts"), { recursive: true });
      // Mutate the copy's TS twin: the copied stub must see it, through the copied tee.
      fs.writeFileSync(path.join(copy, "scripts/probe.ts"), tsEntry("other", "warn", 3));
      fs.symlinkSync(path.join(outer.root, "node_modules"), path.join(copy, "node_modules"));
      fs.writeFileSync(path.join(copy, "package.json"), "{}\n");
      // Break the OUTER tee: if the stub still pointed at it, the run could not reach exit 99.
      fs.writeFileSync(path.join(outer.root, TEE_PATH), "process.exit(0);\n");
      const r = spawnSync("bash", [path.join(copy, "scripts/probe.sh")], {
        cwd: copy,
        env: outer.env,
        encoding: "utf8",
      });
      assert.equal(r.status, 99);
      assert.match(r.stderr, /stdout differs/);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test("stderr noise lines that differ between legs are ignored", () => {
    const noise = String.raw`Traceback \(most recent call last\):|  File ".*", line [0-9]+, in .*|    .*|[A-Za-z_][A-Za-z0-9_.]*(Error|Exception): .*`;
    const sh = {
      ...same,
      err: 'warn\nTraceback (most recent call last):\n  File "/a/b.py", line 3, in <module>\n    x()\njson.JSONDecodeError: bad at 1\n',
    };
    const ts = {
      ...same,
      err: 'warn\nTraceback (most recent call last):\n  File "/c/d.py", line 9, in <module>\n    y()\njson.JSONDecodeError: bad at 2\n',
    };
    const r = runScript(standIn(sh, ts, { stderrNoise: noise }), "probe");
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "hello");
  });

  test("a differing plain Error line is still a divergence under stderr noise", () => {
    const noise = String.raw`[A-Za-z_][A-Za-z0-9_.]+(Error|Exception): .*`;
    const r = runScript(
      standIn(
        { ...same, err: "Error: one\n" },
        { ...same, err: "Error: two\n" },
        { stderrNoise: noise },
      ),
      "probe",
    );
    assert.equal(r.status, 99);
    assert.match(r.stderr, /stderr differs/);
    assert.match(r.stderr, /compared without lines matching/);
  });

  test("statusOnly ignores stdout and stderr but still compares the status", () => {
    const flags = { statusOnly: true };
    assert.equal(
      runScript(standIn(same, { ...same, out: "x", err: "y" }, flags), "probe").status,
      3,
    );
    assert.equal(runScript(standIn(same, { ...same, code: 4 }, flags), "probe").status, 99);
  });
});

describe("governance sandbox contract", { skip }, () => {
  const box = makeSandbox();
  boxes.push(box);

  test("holds exactly the tracked files, plus .git and the two real dependencies", () => {
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" })
      .stdout.split("\0")
      .filter(
        (f) =>
          f !== "" && fs.existsSync(path.join(REPO, f)) && fs.statSync(path.join(REPO, f)).isFile(),
      );
    const present = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.name === ".git" && dir === box.root) continue;
        if (e.isDirectory()) walk(full);
        else present.add(path.relative(box.root, full));
      }
    };
    walk(box.root);
    const extra = [...present].filter(
      (f) => !tracked.includes(f) && !/^node_modules\/(js-yaml|argparse)\//.test(f),
    );
    assert.deepEqual(extra, []);
    assert.deepEqual(
      tracked.filter((f) => !present.has(f)),
      [],
    );
    assert.ok(fs.existsSync(path.join(box.root, ".git")));
  });

  test("js-yaml and argparse are real directories, not symlinks", () => {
    for (const dep of ["js-yaml", "argparse"]) {
      const st = fs.lstatSync(path.join(box.root, "node_modules", dep));
      assert.ok(st.isDirectory() && !st.isSymbolicLink(), dep);
      assert.ok(fs.existsSync(path.join(box.root, "node_modules", dep, "package.json")));
    }
  });

  test("CI and NODE_TEST_CONTEXT are unset in the child env even when set in the parent", () => {
    const saved = { CI: process.env["CI"], CTX: process.env["NODE_TEST_CONTEXT"] };
    process.env["CI"] = "true";
    process.env["NODE_TEST_CONTEXT"] = "child-v8";
    try {
      const fresh = makeSandbox({ minimal: true });
      boxes.push(fresh);
      assert.ok(!("CI" in fresh.env) && !("NODE_TEST_CONTEXT" in fresh.env));
    } finally {
      if (saved.CI === undefined) delete process.env["CI"];
      else process.env["CI"] = saved.CI;
      if (saved.CTX === undefined) delete process.env["NODE_TEST_CONTEXT"];
      else process.env["NODE_TEST_CONTEXT"] = saved.CTX;
    }
  });
});
