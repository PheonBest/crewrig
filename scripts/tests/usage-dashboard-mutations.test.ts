// usage-dashboard-mutations.test.ts — case 13.20 of the usage dashboard suite (M1-M15; replaces the
// mutation pass of test-usage-dashboard.sh, spec 0260 row J1a). Each mutant is applied to a temporary copy
// (never a tracked file), then the test file that holds its target case runs as a child
// `node --test <file>` with USAGE_DASHBOARD_REPO=<mutated copy> and must exit non-zero. Each distinct
// target file also runs once unmutated as a green control. A missing anchor fails (mutateCopy throws).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { after, describe, test } from "node:test";

import { mutateCopy, type MutationCopy } from "./lib/usage-dashboard-mutate.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const D = "scripts/lib/usage-dashboard";
const GUARD = "USAGE_DASHBOARD_MUTATIONS_CHILD";
const NESTED = process.env[GUARD] === "1";
const SKIP =
  process.env["USAGE_DASHBOARD_SKIP_MUTATIONS"] === "1"
    ? "USAGE_DASHBOARD_SKIP_MUTATIONS=1"
    : NESTED
      ? "recursion guard: nested run"
      : false;
const TIMEOUT_MS = 280_000;

interface Mutant {
  id: string;
  file: string;
  regex: RegExp;
  repl: string;
  target: string; // test file (usage-dashboard-<target>.test.ts)
  pattern: string; // --test-name-pattern of the target case
  label: string;
}

const MUTANTS: Mutant[] = [
  {
    id: "M1",
    file: `${D}/text.js`,
    regex: /out\.push\(line\(cellTexts\[i\]\)\);/,
    repl: 'out.push(line(entries[0].path === "totals" && i === 0 ? cellTexts[i].map((c, j) => (j === 1 ? String(Number(c) + 1) : c)) : cellTexts[i]));',
    target: "agreement",
    pattern: "13\\.1 ",
    label: "13.1 (text Totals row)",
  },
  {
    id: "M2",
    file: `${D}/model.js`,
    regex: /entry\.unpricedCount \+= 1;/,
    repl: "entry.pricedCount += 1;",
    target: "agreement",
    pattern: "13\\.4 ",
    label: "13.4 (tallies)",
  },
  {
    id: "M3",
    file: `${D}/html.js`,
    regex: /<meta charset="utf-8">/,
    repl: '<meta charset="utf-8">\n<link rel="stylesheet" href="https://cdn.example/x.css">',
    target: "page",
    pattern: "13\\.12",
    label: "13.12 (static page)",
  },
  {
    id: "M4",
    file: `${D}/server.js`,
    regex: /listen\(([^)]*)'127\.0\.0\.1'/,
    repl: "listen($1'0.0.0.0'",
    target: "server",
    pattern: "13\\.13",
    label: "13.13 (bind)",
  },
  {
    id: "M5",
    file: `${D}/server.js`,
    regex: /if \(!allowedHosts\(\)\.includes\(host\)\)/,
    repl: "if (false)",
    target: "server",
    pattern: "13\\.15",
    label: "13.15 (security)",
  },
  {
    id: "M6",
    file: `${D}/model.js`,
    regex: /store: false,/,
    repl: "store: true,",
    target: "readonly",
    pattern: "13\\.16 GET",
    label: "13.16 (read-only)",
  },
  {
    id: "M7",
    file: `${D}/html.js`,
    regex: /(function embedJson[\s\S]*?\.replace\(\/\[)</,
    repl: "$1",
    target: "page",
    pattern: "13\\.12",
    label: "13.12 (embedJson)",
  },
  {
    id: "M8",
    file: `${D}/model.js`,
    regex: /process\.env\.CREWRIG_USAGE_OFFLINE\s*=\s*'1';?/,
    repl: "",
    target: "readonly",
    pattern: "offline guard",
    label: "13.16 (offline guard)",
  },
  {
    id: "M9",
    file: `${D}/model.js`,
    regex: /entry\.unconvertedCount \+= 1;/,
    repl: "entry.unconvertedCount += 1;\n        sum += p.amount;",
    target: "crosscheck",
    pattern: "13\\.5a",
    label: "13.5a (unconverted)",
  },
  {
    id: "M10",
    file: `${D}/html.js`,
    regex: /\$\{esc\(c\.text\)\}<\/td>` : `<td>/,
    repl: '${esc(/mixed$/.test(c.k) ? "" : c.text)}</td>` : `<td>',
    target: "render",
    pattern: "13\\.9",
    label: "13.9 (mixed marker)",
  },
  {
    id: "M11",
    file: `${D}/text.js`,
    regex: /if \(r\.statement\) out\.push\([^;]*;/,
    repl: "",
    target: "agreement",
    pattern: "13\\.1 ",
    label: "13.2 (price statement)",
  },
  {
    id: "M12",
    file: `${D}/model.js`,
    regex: /contributingRecords\(records\);/,
    repl: "contributingRecords(records.filter(place));",
    target: "buckets",
    pattern: "13\\.7",
    label: "13.7 (placement)",
  },
  {
    id: "M13",
    file: "scripts/lib/usage-store/query.js",
    regex: / && touched\.size === 0\) break;/,
    repl: ") break;",
    target: "buckets",
    pattern: "13\\.7",
    label: "13.7 (readWindow lookahead)",
  },
  {
    id: "M14",
    file: `${D}/html.js`,
    regex: /\n\s*\.replace\(\/\[\\u0000[^\n]*/,
    repl: "",
    target: "page",
    pattern: "hardening",
    label: "hardening (HTML controls)",
  },
  {
    id: "M15",
    file: `${D}/source.js`,
    regex: /const subordinates = sel\.session \? readSubordinates\([^;]*;/,
    repl: "const subordinates = [];",
    target: "render",
    pattern: "i1-F1",
    label: "i1-F1 (session subtree)",
  },
];

function childEnv(repo: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, [GUARD]: "1", NO_PROXY: "127.0.0.1,localhost" };
  delete env["NODE_TEST_CONTEXT"]; // an empty value is not enough: it must be absent
  for (const k of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ])
    delete env[k];
  if (repo === undefined) delete env["USAGE_DASHBOARD_REPO"];
  else env["USAGE_DASHBOARD_REPO"] = repo;
  return env;
}

/** Run `node --test [--test-name-pattern] <file>`; resolves with the exit status (null on a timeout). */
function runTarget(
  target: string,
  repo: string | undefined,
  pattern?: string,
): Promise<number | null> {
  const file = path.join(REPO, "scripts", "tests", `usage-dashboard-${target}.test.ts`);
  const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test"];
  if (pattern !== undefined) args.push(`--test-name-pattern=${pattern}`);
  args.push(file);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO,
      env: childEnv(repo),
      stdio: "ignore",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const copies: MutationCopy[] = [];
after(() => {
  for (const c of copies) c.dispose();
});

describe(
  "13.20 mutations: every mutant turns its target case red",
  { skip: SKIP, concurrency: 4 },
  () => {
    for (const m of MUTANTS) {
      test(
        `13.20 ${m.id} turns ${m.label} red (usage-dashboard-${m.target}.test.ts)`,
        { timeout: TIMEOUT_MS + 20_000 },
        async () => {
          const copy = mutateCopy(m.file, m.regex, m.repl); // throws on a stale anchor: the mutant FAILs loudly
          copies.push(copy);
          const code = await runTarget(m.target, copy.root, m.pattern);
          assert.notEqual(
            code,
            0,
            `${m.id}: the case stayed green against the mutated copy (exit ${String(code)})`,
          );
          assert.notEqual(code, null, `${m.id}: the child timed out`);
        },
      );
    }
  },
);

describe(
  "13.20 green controls: each target file passes unmutated",
  { skip: SKIP, concurrency: 4 },
  () => {
    for (const target of [...new Set(MUTANTS.map((m) => m.target))]) {
      test(
        `13.20 control usage-dashboard-${target}.test.ts is green on the checkout`,
        { timeout: TIMEOUT_MS + 20_000 },
        async () => {
          assert.equal(
            await runTarget(target, undefined),
            0,
            `${target}: the unmutated file is not green`,
          );
        },
      );
    }
  },
);
