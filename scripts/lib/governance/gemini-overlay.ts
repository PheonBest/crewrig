// gemini-overlay.ts — Gemini overlay enrollment logic (spec 0259; replaces the logic of
// scripts/check-gemini-overlay-enrollment.sh, spec 0085).
//
// Usage: checkEnrollment(repoDir, io) -> exit code
// Deployed set: `NN_NAME.md` basenames of the `rules.shared.<n>`, `rules.selection.<kind>` and
// `rules.profile` facts printed by `scripts/tests/lib/print-setup-declarations.ts gemini
// --format json` under `repoDir` (spawned with process.execPath, never imported).
// Enrolled set: basenames of `context.fileName` in config/gemini/settings.json.
// Exit codes: 0 all enrolled, 1 a deployed overlay is not enrolled, 2 fail-closed (missing
// source, broken printer, unparseable or vacuous declaration, malformed settings).
// Finding-line format: the historical `WARNING:` block (printed first) and `FAILED:` block on
// stderr, one `  - <overlay>` line per offender, one `OK:` line on stdout.
// Deviations: the Node.js floor guard step is dropped (this program already runs on Node >= 24);
// python3 tracebacks for non-JSON input are not reproduced (the exit-2 message that follows is).

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const AGENTS_EXCEPTION = "AGENTS.md";
const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const FACT_KEY = /^rules\.(shared\.[0-9]+|selection\.[A-Za-z0-9_-]+|profile)$/;
const OVERLAY = /^[0-9]{2}_[A-Za-z0-9_]+\.md$/;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `sort -u` over lines. */
const sortUnique = (lines: readonly string[]): string[] => [...new Set(lines)].sort(byCodeUnit);

/** Deployed overlay names of a declaration; `null` when the shell's python step would fail. */
function deployedNames(declaration: string, io: Io): string[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(declaration);
  } catch {
    return null;
  }
  if (!isRecord(doc)) return null;
  const facts = doc["facts"];
  if (!isRecord(facts)) {
    io.err("the declaration carries no facts object");
    return null;
  }
  const names: string[] = [];
  for (const [key, value] of Object.entries(facts)) {
    if (!FACT_KEY.test(key)) continue;
    const text = String(value).replace(/ \(optional\)$/, "");
    const arrow = text.lastIndexOf(" -> ");
    const base = basename(arrow === -1 ? text : text.slice(arrow + 4));
    if (OVERLAY.test(base)) names.push(base);
  }
  return sortUnique(names);
}

/** Enrolled basenames; `null` when the settings file is malformed (exit 2). */
function enrolledNames(settingsFile: string, io: Io): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(settingsFile, "utf8"));
  } catch {
    return null;
  }
  const context = isRecord(data) ? data["context"] : undefined;
  if (!isRecord(context)) {
    io.err("context key is absent or not an object");
    return null;
  }
  const fileNames = context["fileName"];
  if (!Array.isArray(fileNames)) {
    io.err("context.fileName is absent or not an array");
    return null;
  }
  if (!fileNames.every((n) => typeof n === "string")) return null;
  // python prints one basename per `print`; embedded newlines split into further lines.
  const lines = fileNames.map((n) => basename(n)).join("\n");
  return sortUnique(lines === "" && fileNames.length === 0 ? [] : lines.split("\n"));
}

export function checkEnrollment(repoDir: string, io: Io): number {
  const printer = `${repoDir}/scripts/tests/lib/print-setup-declarations.ts`;
  const settings = `${repoDir}/config/gemini/settings.json`;
  for (const src of [printer, settings]) {
    if (!isFile(src)) {
      io.err(`Error: source not found: ${src}`);
      return 2;
    }
  }

  const run = spawnSync(process.execPath, [NODE_FLAG, printer, "gemini", "--format", "json"], {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const declaration = (run.stdout ?? "").replace(/\n+$/, "");
  if (run.status !== 0 || declaration === "") {
    io.err(`Error: the declaration printer produced no declaration for gemini (${printer})`);
    io.err(
      "— an empty descriptor or a broken printer; refusing to run a vacuous enrollment check.",
    );
    return 2;
  }
  const deployed = deployedNames(declaration, io);
  if (deployed === null || deployed.length === 0) {
    io.err("Error: no deployed overlays found in the gemini setup declaration — the");
    io.err("declaration shape may have changed; refusing to run a vacuous enrollment check.");
    return 2;
  }

  const enrolled = enrolledNames(settings, io);
  if (enrolled === null) {
    io.err(`Error: could not read a well-formed context.fileName list from ${settings}`);
    io.err("(malformed JSON, or a missing/wrong-typed context.fileName key).");
    return 2;
  }

  const missing = deployed.filter((o) => !enrolled.includes(o));
  const warnings = enrolled.filter(
    (e) => e !== "" && e !== AGENTS_EXCEPTION && !deployed.includes(e),
  );

  if (warnings.length > 0) {
    io.err(
      `WARNING: ${warnings.length} overlay(s) enrolled in context.fileName but not deployed by the setup (per its declaration):`,
    );
    for (const w of warnings) io.err(`  - ${w}`);
    io.err("This is drift, not a failure — either enroll a deploy for it or remove it");
    io.err("from config/gemini/settings.json (spec 0085 R6).");
    io.err("");
  }

  if (missing.length > 0) {
    io.err(
      `FAILED: ${missing.length} deployed Gemini overlay(s) not enrolled in context.fileName (spec 0085):`,
    );
    for (const m of missing) io.err(`  - ${m}`);
    io.err("");
    io.err("The Gemini setup (its declaration) deploys the overlay(s) above to the");
    io.err("Gemini home directory, but config/gemini/settings.json does not enroll them");
    io.err("in context.fileName, so Gemini would silently never load them. Add each to");
    io.err("the context.fileName array.");
    return 1;
  }

  io.out(`OK: all ${deployed.length} deployed Gemini overlays are enrolled in context.fileName.`);
  return 0;
}
