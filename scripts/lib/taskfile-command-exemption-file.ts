// taskfile-command-exemption-file.ts — parse scripts/lib/taskfile-command-exemptions.json.

export interface Exemption {
  task: string;
  command: string;
  owner: string;
  issue: string;
  reason: string;
}

export interface ParsedExemptions {
  entries: Exemption[];
  problems: string[];
}

const ISSUE = /^#\d+$/;
const FIELDS = ["task", "command", "owner", "issue", "reason"] as const;

/** Parse the exemption file; shape errors come back as problems, never as exceptions. */
export function parseExemptions(text: string): ParsedExemptions {
  const entries: Exemption[] = [];
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { entries, problems: ["exemption file is not valid JSON"] };
  }
  const list = (doc as { exemptions?: unknown } | null)?.exemptions;
  if (!Array.isArray(list)) {
    return { entries, problems: ["exemption file needs an 'exemptions' array"] };
  }
  const seen = new Set<string>();
  list.forEach((raw: unknown, i: number) => {
    const rec = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const bad = FIELDS.filter((f) => typeof rec[f] !== "string" || rec[f] === "");
    if (bad.length > 0) {
      problems.push(`exemption #${i} lacks ${bad.join(", ")}`);
      return;
    }
    const entry = rec as unknown as Exemption;
    if (!ISSUE.test(entry.issue)) {
      problems.push(`exemption #${i} issue '${entry.issue}' is not '#<number>'`);
    }
    const key = `${entry.task}\u0000${entry.command}`;
    if (seen.has(key)) {
      problems.push(`exemption #${i} duplicates task '${entry.task}' command '${entry.command}'`);
    }
    seen.add(key);
    entries.push(entry);
  });
  return { entries, problems };
}
