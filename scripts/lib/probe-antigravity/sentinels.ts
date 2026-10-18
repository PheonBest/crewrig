// sentinels.ts — the sentinel matrix, its on-disk materialisation and the exact-restore cleanup.

import fs from "node:fs";
import path from "node:path";

export interface Sentinel {
  readonly kind: "skill" | "agent";
  readonly name: string;
  readonly rel: string;
  readonly label: string;
}

export const SKILL_CONTROL = "agy-customizations";
export const DUP_NAME = "crewrig-probe-agent-dup";
export const DUP_PATHS: readonly string[] = [
  `.gemini/config/agents/${DUP_NAME}.md`,
  `.gemini/agents/${DUP_NAME}.md`,
];

const s = (kind: "skill" | "agent", name: string, rel: string, label: string): Sentinel => ({
  kind,
  name,
  rel,
  label,
});

export const SENTINELS: readonly Sentinel[] = [
  s(
    "skill",
    "crewrig-probe-skill-appdata",
    ".gemini/antigravity-cli/skills/crewrig-probe-skill-appdata",
    "skill, application-data root",
  ),
  s(
    "skill",
    "crewrig-probe-skill-config",
    ".gemini/config/skills/crewrig-probe-skill-config",
    "skill, documented customization root",
  ),
  s(
    "skill",
    "crewrig-probe-skill-gemini",
    ".gemini/skills/crewrig-probe-skill-gemini",
    "skill, Gemini CLI root",
  ),
  s(
    "agent",
    "crewrig-probe-agent-flat-appdata",
    ".gemini/antigravity-cli/agents/crewrig-probe-agent-flat-appdata.md",
    "agent, flat file, application-data root",
  ),
  s(
    "agent",
    "crewrig-probe-agent-flat-config",
    ".gemini/config/agents/crewrig-probe-agent-flat-config.md",
    "agent, flat file, documented customization root",
  ),
  s(
    "agent",
    "crewrig-probe-agent-flat-gemini",
    ".gemini/agents/crewrig-probe-agent-flat-gemini.md",
    "agent, flat file, Gemini CLI root",
  ),
  s(
    "agent",
    "crewrig-probe-agent-dir-appdata",
    ".gemini/antigravity-cli/agents/crewrig-probe-agent-dir-appdata",
    "agent, directory shape, application-data root",
  ),
  s(
    "agent",
    "crewrig-probe-agent-dir-config",
    ".gemini/config/agents/crewrig-probe-agent-dir-config",
    "agent, directory shape, documented customization root",
  ),
  s(
    "agent",
    "crewrig-probe-agent-dir-gemini",
    ".gemini/agents/crewrig-probe-agent-dir-gemini",
    "agent, directory shape, Gemini CLI root",
  ),
];

const SELF = "scripts/probe-antigravity-discovery.ts";

/** Everything the probe created, so cleanup can restore the pre-run tree exactly. */
export class Created {
  readonly paths: string[] = [];
  readonly dirs: string[] = [];

  /** mkdir -p, remembering ONLY the levels that did not exist. */
  ensureDir(target: string, home: string): void {
    const missing: string[] = [];
    let p = target;
    while (!isDir(p) && p !== path.parse(p).root && p !== home) {
      missing.unshift(p);
      p = path.dirname(p);
    }
    fs.mkdirSync(target, { recursive: true });
    this.dirs.push(...missing);
  }

  cleanup(): void {
    for (const p of this.paths) fs.rmSync(p, { recursive: true, force: true });
    for (let i = this.dirs.length - 1; i >= 0; i--) {
      try {
        fs.rmdirSync(this.dirs[i] as string);
      } catch {
        // not empty any more, or already gone
      }
    }
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function writeSkillSentinel(dir: string, name: string, home: string, c: Created): void {
  c.ensureDir(dir, home);
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Discovery probe sentinel for crewrig spec 0123. Safe to delete.\n---\n\n# ${name}\n\nThis file is a throwaway discovery sentinel written by\n\`${SELF}\`. It teaches nothing and does nothing.\n`,
  );
}

export function writeAgentSentinel(
  target: string,
  name: string,
  marker: string,
  home: string,
  c: Created,
): void {
  let file: string;
  if (target.endsWith(".md")) {
    c.ensureDir(path.dirname(target), home);
    file = target;
  } else {
    c.ensureDir(target, home);
    file = path.join(target, "AGENT.md");
  }
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ndescription: "Discovery probe sentinel for crewrig spec 0123 (${marker}). Safe to delete."\n---\n\nThrowaway discovery sentinel written by\n\`${SELF}\`. Do nothing; report the marker\n${marker} if asked.\n`,
  );
}
