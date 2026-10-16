// check-skill-versions.ts — enforce the version-bump rule on component sources.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-skill-versions.ts [<base-ref>]
//
// Every modified (status M) skill, command or agent source under artifacts/core,
// artifacts/library or artifacts/community must add a `version: "..."` line in its
// diff against the base. The base is the argument, else $BASE_REF, else the
// preferred remote's main (develop when main is absent). A base ending in `/` is
// treated as unset. Added, deleted and renamed files are ignored.
//
// Exit: 0 clean, 1 a source lacks a bump, 2 base ref unresolvable.
// Finding lines: `  FAIL <file> — metadata.provenance.version not bumped`.

import { runSkillVersions } from "./lib/governance/skill-versions.ts";

process.exitCode = runSkillVersions(process.argv.slice(2), process.env);
