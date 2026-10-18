# Shell Removal Migration Table

<!-- crewrig-doc: published=false -->

Spec 0266 removes the last Bash entry points of the TypeScript migration
(epic #1231). Each removed path has a TypeScript replacement; this table is the
one place that maps the old path to the new command. Later removal slices add
their rows here.

| Removed path | Replacement command | Removed in |
| --- | --- | --- |
| `artifacts/library/skills/harness-curator/scripts/curate.sh` | `node artifacts/library/skills/harness-curator/scripts/curate.ts` | #1344 (J4, slice S3b) |
| `artifacts/library/skills/harness-curator/scripts/schedule-curator.sh` | `node artifacts/library/skills/harness-curator/scripts/schedule-curator.ts` | #1344 (J4, slice S3b) |
| `artifacts/library/skills/harness-curator/scripts/setup-labels.sh` | `node artifacts/library/skills/harness-curator/scripts/setup-labels.ts` | #1344 (J4, slice S3b) |

From a built skill directory the same commands read `node scripts/curate.ts`,
`node scripts/schedule-curator.ts` and `node scripts/setup-labels.ts`; the
arguments are unchanged.

## Harness Curator scheduled job (manual step)

The three `.sh` files were forwarding shims (spec 0258 R32) that ran the
`.ts` entry. Anything that still invokes them by path fails once they are gone.

- **Linux with a crontab entry.** A crontab written by an earlier
  `schedule-curator.sh` still names `curate.sh`, so the job now fails. Run
  `crontab -e`, delete the marker line
  `# crewrig-harness-curator (managed by schedule-curator.sh)` and the command
  line directly below it, then re-run
  `node artifacts/library/skills/harness-curator/scripts/schedule-curator.ts`
  to register the current schedule (a systemd user timer). The job logs to
  `~/.local/state/crewrig/harness-curator.log`, where the failures appear until
  the entry is removed.
- **macOS.** The launchd plist is replaced in place by the new
  `schedule-curator.ts`; nothing to remove manually.
- **Other callers.** Update any script, alias or CI job that runs
  `bash .../curate.sh`, `bash .../schedule-curator.sh` or
  `bash .../setup-labels.sh` to the `node ...ts` form above.
