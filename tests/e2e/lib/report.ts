// report.ts — TypeScript twin of report.sh: aggregate per-run TAP files into a parity matrix
// (spec 0261 R3). Rows are scenarios, columns are CLIs, cells are pass, fail or skip. The shell ran
// under LC_ALL=C: widths count bytes (a glyph is 3 or 6 bytes) and names sort bytewise; the twin
// keeps both. Paths are resolved against the `cwd` parameter, the clock is a parameter too.

import fs from "node:fs";
import path from "node:path";

export interface ReportResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

const CLIS = ["claude", "gemini", "copilot"] as const;
const GLYPH: Record<string, string> = { pass: "✅", fail: "❌" };
const SKIP = "⚠️";

const USAGE = `report.sh — aggregate per-run TAP files into a parity matrix.

Reads TAP 13 files produced by tests/e2e/run.sh and emits:
  1. A console table to stdout (✅ pass / ❌ fail / ⚠️  skip)
  2. A markdown report at <output-dir>/parity-YYYYMMDD-HHMMSS.md

Exit code: 1 if any cell is ❌, 2 on empty TAP dir, 0 otherwise.

Usage:
  tests/e2e/lib/report.sh [--tap-dir <dir>] [--output-dir <dir>] [--dry-run]

Defaults: --tap-dir tests/e2e/reports/  --output-dir tests/e2e/reports/
`;

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const padEnd = (s: string, w: number) => s + " ".repeat(Math.max(0, w - bytes(s)));
const byteSort = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const glyph = (s: string | undefined) => GLYPH[s ?? ""] ?? SKIP;

/** `*.tap` files under `dir`, as `find <dir> -type f -name '*.tap'` printed them, bytewise sorted. */
function findTaps(dir: string, abs: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...findTaps(`${dir}/${e.name}`, path.join(abs, e.name)));
    else if (e.isFile() && e.name.endsWith(".tap")) out.push(`${dir}/${e.name}`);
  }
  return out;
}

/** Classify the TAP lines of one file into `result` (`<cli>/<scenario>` -> status). */
function readTap(text: string, result: Map<string, string>, seen: Set<string>): void {
  const lines = text.split("\n");
  lines.pop(); // `while read` drops an unterminated last line
  for (let line of lines) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.startsWith("ok ") && !line.startsWith("not ok ")) continue;
    const dash = line.indexOf(" - ");
    if (dash < 0) continue;
    let desc = line.slice(dash + 3);
    let directive = "";
    const first = desc.indexOf(" # ");
    if (first >= 0) {
      directive = desc.slice(first + 3);
      desc = desc.slice(0, desc.lastIndexOf(" # "));
    }
    desc = desc.replace(/^[ \t\n\r\f\v]+/, "").replace(/[ \t\n\r\f\v]+$/, "");
    const slash = desc.indexOf("/");
    const cli = slash < 0 ? desc : desc.slice(0, slash);
    const scen = slash < 0 ? desc : desc.slice(slash + 1);
    if (cli === "" || scen === "" || cli === scen) continue;
    let status = "pass";
    if (line.startsWith("not ok ")) status = "fail";
    else if (directive !== "" && /^(skip|todo)/.test(directive.toLowerCase())) status = "skip";
    result.set(`${cli}/${scen}`, status);
    seen.add(scen);
  }
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** `report.sh [--tap-dir <dir>] [--output-dir <dir>] [--dry-run]`: argv without the program name. */
export function report(args: readonly string[], cwd: string, now: Date): ReportResult {
  let tapDir = "tests/e2e/reports";
  let outputDir = "tests/e2e/reports";
  let dryRun = false;
  for (let i = 0; i < args.length;) {
    const a = args[i];
    if (a === "--tap-dir" || a === "--output-dir") {
      const v = args[i + 1];
      if (v === undefined) return { rc: 1, stdout: "", stderr: `report.sh: ${a}: missing value\n` };
      if (a === "--tap-dir") tapDir = v;
      else outputDir = v;
      i += 2;
    } else if (a === "--dry-run") {
      dryRun = true;
      i += 1;
    } else if (a === "-h" || a === "--help") return { rc: 0, stdout: USAGE, stderr: "" };
    else return { rc: 2, stdout: "", stderr: `report.sh: unknown flag: ${a}\n${USAGE}` };
  }
  const absTap = path.resolve(cwd, tapDir);
  if (!fs.existsSync(absTap) || !fs.statSync(absTap).isDirectory()) {
    return { rc: 2, stdout: "", stderr: `report.sh: tap dir not found: ${tapDir}\n` };
  }
  const files = findTaps(tapDir, absTap).sort(byteSort);
  if (files.length === 0) {
    return {
      rc: 2,
      stdout: "",
      stderr: `report.sh: no .tap files found under ${tapDir}\nRun \`task e2e:test\` first to produce TAP output.\n`,
    };
  }
  const result = new Map<string, string>();
  const seen = new Set<string>();
  for (const f of files) {
    readTap(fs.readFileSync(path.resolve(cwd, f), "utf8"), result, seen);
  }
  const scenarios = [...seen].sort(byteSort);
  const nameW = Math.max(8, ...scenarios.map(bytes));
  const row = (label: string, cells: readonly string[]) =>
    `${padEnd(label, nameW)}${cells.map((c) => `  ${padEnd(c, 8)}`).join("")}\n`;
  let out = row("Scenario", CLIS);
  out += row(
    "-".repeat(nameW),
    CLIS.map(() => "--------"),
  );
  let rc = 0;
  for (const scen of scenarios) {
    const cells = CLIS.map((c) => result.get(`${c}/${scen}`));
    if (cells.includes("fail")) rc = 1;
    out += row(scen, cells.map(glyph));
  }
  if (!dryRun) {
    const ts = stamp(now);
    const target = `${outputDir.replace(/\/$/, "")}/parity-${ts}.md`;
    let md = `# e2e Parity Matrix — ${ts}\n\n| Scenario |${CLIS.map((c) => ` ${c} |`).join("")}\n`;
    md += `|---|${CLIS.map(() => "---|").join("")}\n`;
    for (const scen of scenarios) {
      md += `| ${scen} |${CLIS.map((c) => ` ${glyph(result.get(`${c}/${scen}`))} |`).join("")}\n`;
    }
    md += `\nGenerated by \`task e2e:report\` from \`${tapDir.replace(/\/$/, "")}/*.tap\`\n`;
    fs.mkdirSync(path.resolve(cwd, outputDir), { recursive: true });
    fs.writeFileSync(path.resolve(cwd, target), md);
    out += `\nMarkdown report: ${target}\n`;
  }
  return { rc, stdout: out, stderr: "" };
}

// `node tests/e2e/lib/report.ts [--tap-dir D] [--output-dir D] [--dry-run]` (the shell script's contract).
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = report(process.argv.slice(2), process.cwd(), new Date());
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.rc;
}
