// tls-exec.test.ts — the runtime trust wrapper `scripts/tls-exec.ts` (spec 0084 R2/R7/R11; spec
// 0266 slice 5b). It replaces the retired scripts/lib/tls-exec.sh, whose observable results for the
// contracted cases are recorded here as literals (status passthrough, environment, argument
// vector, status 127 for a missing command). Every case runs in a scratch HOME.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FLAG, parseArgs, runTlsExec, trustEnv } from "../lib/tls-exec/run.ts";
import type { RunDeps } from "../lib/tls-exec/run.ts";

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tls-exec.ts");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tls-exec-"));
const home = path.join(root, "home");
fs.mkdirSync(path.join(home, ".crewrig"), { recursive: true });
const tlsFile = path.join(home, ".crewrig", "tls-env.sh");
after(() => fs.rmSync(root, { recursive: true, force: true }));

function run(args: readonly string[], homeDir = home) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args],
    { encoding: "utf8", env: { PATH: process.env["PATH"], HOME: homeDir, USERPROFILE: homeDir } },
  );
}
const node = (code: string, ...rest: string[]): string[] => [process.execPath, "-e", code, ...rest];

describe("tls-exec.ts entry", () => {
  it("passes the status through and the argument vector verbatim", () => {
    const r = run(
      node("console.log(process.argv.slice(1).join('|'));process.exit(7)", "a b", "", "c"),
    );
    assert.equal(r.status, 7);
    assert.equal(r.stdout, "a b||c\n");
    assert.equal(r.stderr, "");
  });

  it("is transparent when the managed file is absent", () => {
    const r = run(node("console.log(process.env.SSL_CERT_FILE ?? 'unset')"));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "unset\n");
    assert.equal(r.stderr, "");
  });

  it("applies the managed file's variables to the command", () => {
    fs.writeFileSync(tlsFile, "# managed\nexport SSL_CERT_FILE=/etc/ssl/ca.pem\n");
    const r = run(node("console.log(process.env.SSL_CERT_FILE)"));
    assert.equal(r.stdout, "/etc/ssl/ca.pem\n");
    assert.equal(r.stderr, "");
  });

  it("warns once on a malformed file, applies nothing and still runs the command", () => {
    fs.writeFileSync(tlsFile, "export OK=1\n$(touch /nonexistent/pwned)\n");
    const r = run(node("console.log(process.env.OK ?? 'unset')"));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "unset\n");
    assert.equal(r.stderr, `tls-exec: ignoring ${tlsFile}: line 2 is outside the managed format\n`);
    fs.rmSync(tlsFile);
  });

  it("exits 127 for a command that is not found", () => {
    const r = run([path.join(root, "no-such-command"), "x"]);
    assert.equal(r.status, 127);
  });

  it("prints one usage line and exits 2 with no command", () => {
    const r = run([]);
    assert.equal(r.status, 2);
    assert.equal(r.stderr, `usage: tls-exec.ts [${FLAG}] <command> [args...]\n`);
  });

  it("ends non-zero on a clean child exit only when flagged", () => {
    assert.equal(run([FLAG, ...node("process.exit(0)")]).status, 1);
    assert.equal(run([FLAG, ...node("process.exit(4)")]).status, 4);
    assert.equal(run(node("process.exit(0)")).status, 0);
  });
});

describe("tls-exec run module", () => {
  it("parses the flag in first position only", () => {
    assert.deepEqual(parseArgs([FLAG, "a", FLAG]), { flagged: true, command: ["a", FLAG] });
    assert.deepEqual(parseArgs(["a", FLAG]), { flagged: false, command: ["a", FLAG] });
  });

  it("builds the environment without mutating the base", () => {
    const base = { PATH: "/bin" };
    assert.deepEqual(trustEnv(path.join(root, "absent-home"), base), { env: { PATH: "/bin" } });
    assert.deepEqual(base, { PATH: "/bin" });
  });

  it("reports the usage and the exit code through its seams", () => {
    const seen: string[] = [];
    const deps: RunDeps = {
      home,
      baseEnv: {},
      stdout: (t) => seen.push(`out:${t}`),
      stderr: (t) => seen.push(`err:${t}`),
      exit: (c) => seen.push(`exit:${c}`),
      spawnChild: () => {
        throw new Error("must not spawn");
      },
      onSignal: () => {},
    };
    runTlsExec([], deps);
    assert.deepEqual(seen, [`err:usage: tls-exec.ts [${FLAG}] <command> [args...]\n`, "exit:2"]);
  });
});
