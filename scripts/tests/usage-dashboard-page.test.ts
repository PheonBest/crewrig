// usage-dashboard-page.test.ts — case 13.12 (the static page) and the hardening case (control characters,
// a symlink planted at the --out path) of the usage dashboard suite (spec 0210 R26-R30; replaces the
// matching groups of test-usage-dashboard.sh, spec 0260 row J1a). Modes 600/700, umask 000 and the planted
// symlink are POSIX-only and skip on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { extractEmbedded } from "./lib/usage-dashboard-checks.ts";
import type { View } from "./lib/usage-dashboard-views.ts";
import {
  dash,
  drv,
  FIXTURES,
  freshSandbox,
  PRICING,
  readText,
  runEntry,
} from "./lib/usage-dashboard-rig.ts";
import { cleanupAll, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(() => cleanupAll());

const JSON_BLOCK = /(<script\b[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script)/i;
interface Hostile {
  identity: { agentId: string };
  attribution: { externalAsset: { ref: string } };
}
const hostile = JSON.parse(
  readText(path.join(FIXTURES, "records", "r10-hostile-child.json")),
) as Hostile;

const sb = freshSandbox();
const page = path.join(sb.root, "dashboard", "usage-dashboard.html");
const written = dash(["page"], sb);
const mode = (f: string): string => (fs.statSync(f).mode & 0o777).toString(8);
const html = (): string => readText(page);
const markup = (): string => html().replace(JSON_BLOCK, "$1$3");

describe("13.12 case_static_page", () => {
  test("13.12 page writes <root>/dashboard/usage-dashboard.html by default", () => {
    assert.equal(fs.existsSync(page), true, `${written.stdout}${written.stderr}`.slice(0, 300));
  });
  test("13.12 page prints the path it wrote", () => {
    assert.ok(written.stdout.includes(page), written.stdout.slice(0, 200));
  });
  test('13.12 exactly one <script and one </script, type="application/json"', () => {
    const h = html();
    assert.equal(h.split("<script").length - 1, 1, "one <script");
    assert.equal(h.split("</script").length - 1, 1, "one </script");
    assert.match(h, /<script[^>]*type="application\/json"/);
  });
  test("13.12 no <!-- anywhere in the file", () => {
    assert.equal(html().includes("<!--"), false);
  });
  test("13.12 no <link, src=, href=, srcset=, action=, poster=, url(, @import, fetch(, XMLHttpRequest, import( outside the JSON data block", () => {
    const m = markup();
    const tags = (m.match(/<[A-Za-z][^>]*>/g) ?? []).join("\n");
    const styles = (m.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []).join("\n");
    const hits: string[] = [];
    if (/<link\b/i.test(tags)) hits.push("<link");
    const attr = /\s(src|href|srcset|action|poster)\s*=/i.exec(tags);
    if (attr) hits.push(`${attr[1]}=`);
    if (/url\(|@import/i.test(styles)) hits.push("url( or @import in <style>");
    for (const p of [/fetch\(/, /XMLHttpRequest/, /import\(/]) if (p.test(m)) hits.push(String(p));
    assert.deepEqual(hits, []);
  });
  test("13.12 a CSP meta carries default-src 'none'", () => {
    assert.match(html(), /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*default-src 'none'/);
  });
  test("13.12 the embedded JSON carries the literal six-byte escape \\u003c/script for the hostile record", () => {
    assert.ok(html().includes("\\u003c/script"));
  });
  test("13.12 the hostile agentId and asset ref parse back byte-identical", () => {
    const v = extractEmbedded(html());
    const agents = v.sessions.flatMap((s) => s.agents ?? []).map((a) => a.agentId);
    assert.ok(agents.includes(hostile.identity.agentId), "agentId round-trips");
    assert.ok(
      v.assets.map((a) => a.ref).includes(hostile.attribution.externalAsset.ref),
      "asset ref round-trips",
    );
  });
  test("13.12 the hostile string is escaped in the markup, and no raw U+2028/U+2029 sits in the JSON block", () => {
    const m = markup();
    assert.equal(/evil\.example\/x\.js"/.test(m), false, "no evil.example script");
    assert.equal(/<script\b[^>]*\bsrc/i.test(m), false, "no script src");
    assert.equal(/[\u2028\u2029]/.test(JSON_BLOCK.exec(html())![2]!), false, "no raw U+2028/9");
  });
  test("13.12 the footer states generatedAt, the regeneration command and its --as-of-today variant (R12)", () => {
    const gen = String(
      (extractEmbedded(html()) as unknown as { generatedAt?: string }).generatedAt ?? "",
    );
    const h = html();
    assert.notEqual(gen, "", "generatedAt is set");
    assert.ok(h.includes(gen), "footer generatedAt");
    assert.ok(h.includes("--as-of-today"), "--as-of-today");
    assert.ok(h.includes("task usage:dashboard"), "task usage:dashboard");
  });
  test("13.12 the file is mode 600 in a mode-700 directory", { skip: SKIP_POSIX }, () => {
    assert.deepEqual([mode(page), mode(path.dirname(page))], ["600", "700"]);
  });
  test("13.12 regenerating under umask 000 keeps mode 600", { skip: SKIP_POSIX }, () => {
    const old = process.umask(0);
    try {
      const r = dash(["page"], sb);
      assert.equal(r.status, 0, r.stderr.slice(0, 200));
    } finally {
      process.umask(old);
    }
    assert.equal(mode(page), "600");
  });
});

describe("hardening case_control_chars", () => {
  const ctl = freshSandbox("empty");
  const out = realTmp("ud-ctl-");
  drv("pin-only", [PRICING], ctl.env);
  drv("write-dir", [path.join(FIXTURES, "records-controls")], ctl.env);
  const want = JSON.parse(
    readText(path.join(FIXTURES, "records-controls", "c02-ctl-child.json")),
  ) as Hostile;
  const ids = (v: View): [string[], string[]] => [
    v.sessions.flatMap((s) => s.agents ?? []).map((a) => a.agentId),
    v.assets.map((a) => a.ref),
  ];

  test("hardening: report --json escapes U+007F-U+009F, U+2028, U+2029 as \\uXXXX and round-trips the identifiers exactly", () => {
    const c = dash(["report", "--json"], ctl);
    const raw = c.stdout;
    assert.equal(
      new RegExp(`[\\x7f-\\x9f${String.fromCharCode(0x2028, 0x2029)}]`).test(raw),
      false,
      "a raw DEL, C1, U+2028 or U+2029 character is in the --json output",
    );
    for (const hex of ["007f", "0080", "0085", "009f", "2028", "2029"])
      assert.ok(raw.includes(`\\u${hex}`), `a \\u${hex} escape is in the --json output`);
    const [agents, refs] = ids(JSON.parse(raw) as View);
    assert.ok(agents.includes(want.identity.agentId), "agentId round-trips");
    assert.ok(refs.includes(want.attribution.externalAsset.ref), "asset ref round-trips");
  });

  test("hardening: HTML text and attributes map C0 (not tab/newline), DEL and C1 to U+FFFD; the embedded JSON round-trips exactly", () => {
    const f = path.join(out, "c.html");
    const r = dash(["page", "--out", f], ctl);
    assert.equal(r.status, 0, r.stderr.slice(0, 200));
    const h = readText(f);
    const block = JSON_BLOCK.exec(h);
    assert.ok(block, "a JSON block");
    const m = h.replace(block[2]!, "");
    const ctlRe = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
    const hit = ctlRe.exec(m);
    assert.equal(hit, null, `markup carries a raw control character ${hit?.[0].charCodeAt(0)}`);
    assert.ok(m.includes("\ufffd"), "markup carries U+FFFD");
    assert.ok(m.includes("tab\there"), "the tab was kept");
    assert.equal(ctlRe.test((m.match(/<[A-Za-z][^>]*>/g) ?? []).join("\n")), false, "attributes");
    assert.equal(
      new RegExp(`[\\x7f-\\x9f${String.fromCharCode(0x2028, 0x2029)}]`).test(block[2]!),
      false,
      "JSON block has no raw DEL, C1, U+2028, U+2029",
    );
    const [agents, refs] = ids(JSON.parse(block[2]!) as View);
    assert.ok(agents.includes(want.identity.agentId), "embedded agentId round-trips");
    assert.ok(refs.includes(want.attribution.externalAsset.ref), "embedded asset ref round-trips");
  });

  test(
    "hardening: page --out onto a planted symlink replaces the link (mode 600) and never writes through it",
    { skip: SKIP_POSIX },
    () => {
      const victim = path.join(out, "victim.txt");
      fs.writeFileSync(victim, "victim-content\n");
      const dir = path.join(out, "sl");
      fs.mkdirSync(dir, { recursive: true });
      const link = path.join(dir, "usage-dashboard.html");
      fs.symlinkSync(victim, link);
      const r = runEntry("usage-dashboard", ["page", "--out", link], ctl);
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(0, 200));
      assert.equal(readText(victim), "victim-content\n", "victim untouched");
      assert.equal(fs.lstatSync(link).isSymbolicLink(), false, "link replaced");
      assert.equal((fs.lstatSync(link).mode & 0o777).toString(8), "600");
      assert.doesNotThrow(() => extractEmbedded(readText(link)));
    },
  );
});
