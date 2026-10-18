// ext-version-bump.ts — logic of the extension version-bump check (spec 0259),
// the TypeScript twin of scripts/check-extension-version-bump.sh (spec 0044).
//
// Reuses carrier.ts (twin of the retired provenance-carrier.sh), base-ref.ts and bump-scan.ts.
//
// Usage: runVersionBump(baseArg, cwd) -> { code, stdout, stderr }
// Exit codes: 0 all bumped or exempt, 1 a failure, 2 unresolvable base ref.
// Finding-line format: `  FAIL <path> — <reason>`, `  OK   <path> ...`.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  defaultBaseRef,
  ensureBaseResolvable,
  normalizeBaseRef,
  preferredRemote,
  unresolvableBaseLines,
} from "./base-ref.ts";
import { modifiedFiles } from "./bump-scan.ts";
import { carrierField, firstBodyLine } from "./carrier.ts";
import * as text from "./ext-version-bump-text.ts";
import { runGit } from "./git-run.ts";

export interface BumpOutcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

const PATHSPECS = [
  "extensions/core/skills/*/SKILL.md",
  "extensions/library/skills/*/SKILL.md",
  "extensions/core/agents/*/AGENT.md",
  "extensions/library/agents/*/AGENT.md",
];

const CARRIER_PREFIX = "<!-- crewrig-provenance:";
const CARRIER_SUFFIX = "-->";

/** The shell glob `"<!-- crewrig-provenance:"*"-->"`. */
export function isCarrierLine(line: string): boolean {
  return (
    line.length >= CARRIER_PREFIX.length + CARRIER_SUFFIX.length &&
    line.startsWith(CARRIER_PREFIX) &&
    line.endsWith(CARRIER_SUFFIX)
  );
}

function baseCarrierLine(base: string, file: string, cwd: string): string {
  const res = runGit(["show", `${base}:${file}`], { cwd });
  return res.status === 0 ? firstBodyLine(res.stdout.toString("utf8")) : "";
}

function isFile(abs: string): boolean {
  return existsSync(abs) && statSync(abs).isFile();
}

export function runVersionBump(baseArg: string, cwd: string = process.cwd()): BumpOutcome {
  const out: string[] = [];
  let base = normalizeBaseRef(baseArg);
  if (base === "") base = defaultBaseRef(preferredRemote(cwd), cwd);
  if (!ensureBaseResolvable(base, cwd))
    return { code: 2, stdout: out, stderr: [...unresolvableBaseLines(base, true)] };

  const modified = modifiedFiles(base, PATHSPECS, cwd);
  if (modified.length === 0) {
    out.push(`${text.NO_MODIFIED_PREFIX}${base}.`);
    return { code: 0, stdout: out, stderr: [] };
  }
  out.push(text.checkingLine(modified.length));

  const failures: string[] = [];
  for (const f of modified) {
    const abs = path.join(cwd, f);
    if (!isFile(abs)) continue;
    const newVersion = carrierField(firstBodyLine(readFileSync(abs, "utf8")), "version");
    if (newVersion === "") {
      out.push(text.newCarrierMissing(f));
      failures.push(f);
      continue;
    }
    const oldLine = baseCarrierLine(base, f, cwd);
    if (!isCarrierLine(oldLine)) {
      out.push(text.exemptNoBaseCarrier(f));
      continue;
    }
    const oldVersion = carrierField(oldLine, "version");
    if (oldVersion === "") {
      out.push(text.baseVersionEmpty(f));
      failures.push(f);
    } else if (newVersion === oldVersion) {
      out.push(text.notBumped(f, newVersion));
      failures.push(f);
    } else {
      out.push(text.bumped(f, oldVersion, newVersion));
    }
  }

  if (failures.length > 0) {
    out.push(...text.failureSummary(failures));
    return { code: 1, stdout: out, stderr: [] };
  }
  out.push("", text.ALL_BUMPED);
  return { code: 0, stdout: out, stderr: [] };
}
