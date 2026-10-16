// check-markdown-links.test.ts — black-box edge cases for scripts/check-markdown-links.ts
// that the Bash suite does not cover (spec 0259 requirement 16). Each case also runs
// the shell script (python3) under LC_ALL=C and compares stdout, stderr and status.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-markdown-links.ts");
const SHELL = path.join(SCRIPTS, "check-markdown-links.sh");
const WIN = process.platform === "win32";
const oracle =
  !WIN &&
  spawnSync("bash", ["--version"]).status === 0 &&
  spawnSync("python3", ["-V"]).status === 0;
if (!WIN && !oracle && process.env.CI)
  throw new Error("bash and python3 are required in CI for the oracle comparison");

let repo = "";
before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "md-links-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: repo });
  git("init", "-q");
  mkdirSync(path.join(repo, "docs/sub"), { recursive: true });
  writeFileSync(path.join(repo, "docs/real.md"), "");
  writeFileSync(path.join(repo, "b"), "");
  writeFileSync(path.join(repo, "docs/sub/(p).md"), "");
  if (!WIN) symlinkSync("real.md", path.join(repo, "docs/link.md"));
  if (!WIN) symlinkSync("missing-target", path.join(repo, "docs/dangling.md"));
  git("add", ".");
});
after(() => rmSync(repo, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(cmd, args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Write `docs/case.md` with the given bytes, run the twin, compare to the shell. */
function check(content: string | Buffer): Run {
  writeFileSync(path.join(repo, "docs/case.md"), content);
  const ts = run(process.execPath, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    ENTRY,
    "docs/case.md",
  ]);
  if (oracle) assert.deepEqual(ts, run("bash", [SHELL, "docs/case.md"], { LC_ALL: "C" }));
  return ts;
}

const FAIL = (line: number, target: string, resolved: string): string =>
  `FAIL: docs/case.md:${line}: '${target}' -> resolved to '${resolved}' (does not exist)\n`;

describe("check-markdown-links edge cases", () => {
  it("counts lone CR as a line ending", () => {
    const r = check("a\r[x](nope1.md)\rb\r\n[y](nope2.md)\n");
    assert.match(r.stdout, /case\.md:2: 'nope1\.md'/);
    assert.match(r.stdout, /case\.md:4: 'nope2\.md'/);
  });

  it("does not count U+2028 or form feed as a line ending", () => {
    const r = check("a [x](nope.md)\f\n[y](nope.md)\n");
    assert.match(r.stdout, /case\.md:1:/);
    assert.match(r.stdout, /case\.md:2:/);
  });

  it("strips the Python whitespace set before the fence test", () => {
    const r = check(" \u0085```\n[x](nope.md)\n```\n[y](nope.md)\n");
    assert.equal(r.status, 1);
  });

  it("decodes %FF as a replacement character and %C3%A9 as one letter", () => {
    const r = check("[x](%FF.md) [y](caf%C3%A9.md) [z](%E2%82.md) [w](%zz.md)\n");
    assert.match(r.stdout, /resolved to 'docs\/\uFFFD\.md'/);
    assert.match(r.stdout, /resolved to 'docs\/café\.md'/);
  });

  it("keeps a leading double slash and collapses a triple one", () => {
    const r = check("[x](//a/../b) [y](///c/../d) [z](../b)\n");
    assert.ok(r.stdout.includes(FAIL(1, "//a/../b", "//b")));
    assert.match(r.stdout, /resolved to '\/d'/);
  });

  it("stops a target at the first closing parenthesis", () => {
    const r = check("[x](sub/(p).md) [y](a(b)c) [z](sub/(p)\n");
    assert.equal(r.stdout.includes("'sub/(p'"), true);
    assert.equal(r.stdout.includes("'a(b'"), true);
  });

  it("handles angle-bracket targets with spaces", () => {
    const r = check("[x](<real.md>) [y](<no such.md>) [z](<<real.md>>)\n");
    assert.equal(r.stdout.includes("'no such.md'"), true);
    assert.equal(r.stdout.includes("'real.md'"), false);
  });

  it("follows symlinks and accepts directory targets", () => {
    const r = check("[a](link.md) [b](dangling.md) [c](sub) [d](.) [e](../docs/)\n");
    assert.equal(r.stdout.includes("'dangling.md'"), !WIN);
    assert.equal(r.stdout.includes("'sub'"), false);
  });

  it("ignores invalid UTF-8 bytes and keeps genuine U+FFFD", () => {
    check(
      Buffer.from(
        "[x](a\xff\xfe.md)\n[y](\xe2\x82.md) \xef\xbf\xbd [z](\xef\xbf\xbd.md)\n",
        "latin1",
      ),
    );
  });

  it("treats a scheme case-insensitively, including dotless i and long s", () => {
    check("[a](HTTPS://x) [b](MailTo:x) [c](ſtp:x) [d](maılto:x) [e](İtem.md) [f](Ftp:y)\n");
  });

  it("skips templated, issue and pull targets, and drops fragments", () => {
    check(
      "[a](${X}/p) [b]({{y}}) [c](../../pull/12) [d](real.md#f) [e](#only) [g](../a b/issues/3)\n",
    );
  });

  it("ignores inline code and fenced blocks", () => {
    check("`[a](nope.md)` [b](nope2.md)\n```md\n[c](nope3.md)\n```\n[d](nope4.md)\n");
  });

  it("scans every tracked markdown file when given no argument", () => {
    const ts = run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY]);
    if (oracle) assert.deepEqual(ts, run("bash", [SHELL], { LC_ALL: "C" }));
  });
});
