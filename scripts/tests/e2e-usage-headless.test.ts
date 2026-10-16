// Twin proof for scripts/lib/usage-headless.ts (spec 0261): the six R18 checks of group G15 of
// test-usage-capture.sh section 10 are asserted on the TypeScript twin directly and on the shell
// leg when bash is available, and the two legs are compared on stored records and file bytes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  usageHeadlessAgyRewriteJsonResponse,
  usageHeadlessCaptureUsageFile,
} from "../lib/usage-headless.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "usage-capture", "headless");
const AGY_ENVELOPE = path.join(FIXTURES, "antigravity-envelope", "envelope.json");
const COPILOT_ENVELOPE = path.join(FIXTURES, "copilot-cli-envelope", "envelope.json");
interface Json {
  response?: string;
  timing: { captureInstant?: string };
  identity: { sessionId: string };
  idempotencyKey?: string;
  recordId?: string;
}
const LAUNCH = "2026-01-01T00:00:00.000Z";
const CANARY = String((JSON.parse(fs.readFileSync(AGY_ENVELOPE, "utf8")) as Json).response).split(
  ":",
)[0];

const bash = spawnSync("bash", ["-c", "command -v mktemp grep node"], { encoding: "utf8" });
const BASH_SKIP = bash.status === 0 ? false : "bash (with mktemp, grep, node) is not available";
const REAL_NODE = process.execPath;
const roots: string[] = [];

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

interface Scratch {
  readonly work: string;
  readonly home: string;
  readonly usage: string;
  readonly tmp: string;
  readonly bin: string;
  readonly scan: string;
}

function scratch(): Scratch {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-headless-"));
  roots.push(work);
  const s = {
    work,
    home: path.join(work, "home"),
    usage: path.join(work, "usage"),
    tmp: path.join(work, "tmp"),
    bin: path.join(work, "bin"),
    scan: path.join(work, "scan.log"),
  };
  for (const d of [s.home, s.usage, s.tmp, s.bin]) fs.mkdirSync(d);
  fs.writeFileSync(s.scan, "");
  // The shell leg's two shims: mktemp pinned under TMPDIR, node followed by a scan of TMPDIR.
  const realMktemp = spawnSync("bash", ["-c", "command -v mktemp"], {
    encoding: "utf8",
  }).stdout.trim();
  fs.writeFileSync(
    path.join(s.bin, "mktemp"),
    `#!/bin/bash\nexec "${realMktemp}" "$@" "${s.tmp}/tmp.XXXXXXXXXX"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(s.bin, "node"),
    `#!/bin/bash\n"${REAL_NODE}" "$@"\nrc=$?\ngrep -rlF -- "${CANARY}" "${s.tmp}" >> "${s.scan}" 2>/dev/null\nexit $rc\n`,
    { mode: 0o755 },
  );
  return s;
}

function envOf(s: Scratch): Record<string, string> {
  return {
    HOME: s.home,
    TMPDIR: s.tmp,
    CREWRIG_USAGE_ROOT: s.usage,
    PATH: `${s.bin}:/usr/bin:/bin`,
  };
}

type Fn = "agy" | "usage";
type Leg = "ts" | "shell";

/** Runs one function on one leg; the TS leg also spies on every file write for the reply canary. */
function call(leg: Leg, fn: Fn, s: Scratch, file: string): void {
  if (leg === "shell") {
    const name =
      fn === "agy"
        ? "usage_headless_agy_rewrite_json_response"
        : "usage_headless_capture_usage_file";
    const args = fn === "agy" ? `"$1" "${LAUNCH}"` : `copilot-cli "$1" "${LAUNCH}"`;
    spawnSync("bash", ["-c", `. scripts/lib/usage-headless.sh; ${name} ${args}`, "bash", file], {
      cwd: REPO,
      env: envOf(s),
      encoding: "utf8",
    });
    return;
  }
  const realWrite = fs.writeFileSync;
  const spy = ((
    target: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    ...rest: unknown[]
  ) => {
    if (
      String(target) !== file &&
      String(data).includes(CANARY) &&
      String(target).startsWith(s.tmp)
    ) {
      fs.appendFileSync(s.scan, `${String(target)}\n`);
    }
    return (realWrite as (...a: unknown[]) => void)(target, data, ...rest);
  }) as typeof fs.writeFileSync;
  fs.writeFileSync = spy;
  try {
    if (fn === "agy") usageHeadlessAgyRewriteJsonResponse(file, LAUNCH, envOf(s), { cwd: REPO });
    else usageHeadlessCaptureUsageFile("copilot-cli", file, LAUNCH, envOf(s), { cwd: REPO });
  } finally {
    fs.writeFileSync = realWrite;
  }
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function records(s: Scratch): string[] {
  return walk(path.join(s.usage, "journal")).filter(
    (f) => f.endsWith(".json") && !/\.(wing|attr)\.json$/.test(f),
  );
}

function seed(s: Scratch, name: string, content: Buffer | string): string {
  const f = path.join(s.work, name);
  fs.writeFileSync(f, content);
  return f;
}

const legs: { leg: Leg; skip: string | false }[] = [
  { leg: "ts", skip: false },
  { leg: "shell", skip: BASH_SKIP },
];

for (const { leg, skip } of legs) {
  describe(`G15 R18 in-place rewrite (${leg})`, { skip }, () => {
    const s = scratch();
    const out = seed(s, "agy-out.txt", fs.readFileSync(AGY_ENVELOPE));
    const want = String((JSON.parse(fs.readFileSync(AGY_ENVELOPE, "utf8")) as Json).response);
    call(leg, "agy", s, out);

    it("writes the reply to the out file byte for byte", () => {
      assert.equal(fs.readFileSync(out, "utf8"), want);
    });
    it("stores exactly one record and leaves the canary out of the usage root", () => {
      assert.equal(records(s).length, 1);
      assert.deepEqual(
        walk(s.usage).filter((f) => fs.readFileSync(f, "utf8").includes(CANARY)),
        [],
      );
    });
    it("never lets a TMPDIR file hold the reply", () => {
      assert.equal(fs.readFileSync(s.scan, "utf8"), "");
    });
    it("leaves TMPDIR empty", () => {
      assert.deepEqual(fs.readdirSync(s.tmp), []);
    });
    for (const [name, content] of [
      ["non-JSON", "agy: error: deadline exceeded"],
      ["non-string response", '{"conversation_id":"c","status":"error","response":null}\n'],
      ["empty", ""],
    ] as const) {
      it(`leaves a ${name} file byte-identical`, () => {
        const f = seed(s, `${name.replace(/\W/g, "-")}.txt`, content);
        call(leg, "agy", s, f);
        assert.equal(fs.readFileSync(f, "utf8"), content);
        assert.equal(records(s).length, 1);
      });
    }
  });
}

describe("differential twin vs shell", { skip: BASH_SKIP }, () => {
  function normalised(s: Scratch): string[] {
    return records(s)
      .map((f) => {
        const r = JSON.parse(fs.readFileSync(f, "utf8")) as Json;
        delete r.timing.captureInstant;
        // Without a session id the key digests the capture instant, so it differs by design.
        if (String(r.identity.sessionId).startsWith("run-total-unreported:")) {
          delete r.idempotencyKey;
          delete r.recordId;
        }
        return JSON.stringify(r);
      })
      .sort();
  }

  for (const [label, fn, content] of [
    ["agy envelope", "agy", fs.readFileSync(AGY_ENVELOPE)],
    ["agy non-JSON", "agy", "oops"],
    ["agy non-string response", "agy", '{"response":3}'],
    ["copilot usage file", "usage", fs.readFileSync(COPILOT_ENVELOPE)],
    ["copilot unparseable usage file", "usage", "not json"],
    ["copilot empty usage file", "usage", ""],
  ] as const) {
    it(`${label}: same out file and same stored records`, () => {
      const a = scratch();
      const b = scratch();
      const fa = seed(a, "o.txt", content);
      const fb = seed(b, "o.txt", content);
      call("ts", fn, a, fa);
      call("shell", fn, b, fb);
      assert.deepEqual(fs.readFileSync(fa), fs.readFileSync(fb));
      assert.deepEqual(normalised(a), normalised(b));
    });
  }

  it("resolves CREWRIG_USAGE_ROOT at call time, defaulting to HOME/.crewrig/usage", () => {
    for (const leg of ["ts", "shell"] as const) {
      const s = scratch();
      const f = seed(s, "o.txt", fs.readFileSync(AGY_ENVELOPE));
      const env = { ...envOf(s), CREWRIG_USAGE_ROOT: "" };
      if (leg === "ts") usageHeadlessAgyRewriteJsonResponse(f, LAUNCH, env, { cwd: REPO });
      else
        spawnSync(
          "bash",
          [
            "-c",
            `. scripts/lib/usage-headless.sh; usage_headless_agy_rewrite_json_response "$1" "${LAUNCH}"`,
            "bash",
            f,
          ],
          { cwd: REPO, env, encoding: "utf8" },
        );
      assert.equal(walk(path.join(s.home, ".crewrig", "usage", "journal")).length > 0, true, leg);
    }
  });
});
