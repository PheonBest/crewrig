# Termination audit of epic #1231 (spec 0215 requirement 25, spec 0266 requirement 19)

<!-- crewrig-doc: published=false -->

Generated 2026-10-18T10:04:48.581Z by `scripts/audit-termination.ts` at HEAD `048f30d1c7c83abd4c559a03520f805b31b250da`. Every figure below comes from a command run at audit time (command log at the end).

Self-check: PASSED.

## 1. Specs of the epic

Evidence: `git ls-files specs`, the first 60 lines of each spec, `gh issue view 1231 --repo crewrig/crewrig --json body` (cross-check only).

Totals by status: implemented=30, approved=3 (33 specs).

| id   | file                                                         | status      | version | related issue | found by                 | flag            |
| ---- | ------------------------------------------------------------ | ----------- | ------- | ------------- | ------------------------ | --------------- |
| 0215 | specs/0215-shell-to-typescript-migration.delta-01.md         | implemented | 2.0.0   | #1231         | 0215 or delta            |                 |
| 0215 | specs/0215-shell-to-typescript-migration.delta-02.md         | implemented | 3.0.0   | #1324         | 0215 or delta            |                 |
| 0215 | specs/0215-shell-to-typescript-migration.delta-03.md         | implemented | 4.0.0   | #1324         | 0215 or delta            |                 |
| 0215 | specs/0215-shell-to-typescript-migration.delta-04.md         | approved    | 4.1.0   | #1231         | 0215 or delta            | NOT IMPLEMENTED |
| 0215 | specs/0215-shell-to-typescript-migration.delta-05.md         | implemented | 4.2.0   | #1231         | 0215 or delta            |                 |
| 0215 | specs/0215-shell-to-typescript-migration.delta-06.md         | approved    | 4.3.0   | #1231         | 0215 or delta            | NOT IMPLEMENTED |
| 0215 | specs/0215-shell-to-typescript-migration.md                  | approved    | 1.0.0   | #1231         | 0215 or delta            | NOT IMPLEMENTED |
| 0237 | specs/0237-windows-hook-cli-matrix.md                        | implemented | 1.0.0   | #1322         | cites parent             |                 |
| 0238 | specs/0238-shell-ratchet-and-typescript-toolchain.md         | implemented | 1.0.0   | #1321         | cites parent             |                 |
| 0240 | specs/0240-runtime-foundations-shared-ts-modules.md          | implemented | 1.0.0   | #1324         | cites parent             |                 |
| 0243 | specs/0243-usage-capture-hooks-typescript.md                 | implemented | 1.0.0   | #1326         | cites parent; epic table |                 |
| 0245 | specs/0245-playwright-mcp-tls-exec.md                        | implemented | 1.0.0   | #1416         | epic table               |                 |
| 0247 | specs/0247-mempalace-transcript-hook-typescript.md           | implemented | 1.0.0   | #1329         | cites parent; epic table |                 |
| 0248 | specs/0248-worktree-git-guard-typescript.md                  | implemented | 1.0.0   | #1328         | cites parent; epic table |                 |
| 0250 | specs/0250-component-build-core-typescript.delta-01.md       | implemented | 2.0.0   | #1332         | cites parent             |                 |
| 0250 | specs/0250-component-build-core-typescript.md                | implemented | 1.0.0   | #1332         | cites parent; epic table |                 |
| 0252 | specs/0252-windows-service-management.md                     | implemented | 1.0.0   | #1330         | cites parent; epic table |                 |
| 0253 | specs/0253-history-import-operational-commands-typescript.md | implemented | 1.0.0   | #1331         | cites parent; epic table |                 |
| 0254 | specs/0254-extension-plugin-builders-typescript.delta-01.md  | implemented | 2.0.0   | #1333         | cites parent             |                 |
| 0254 | specs/0254-extension-plugin-builders-typescript.md           | implemented | 1.0.0   | #1333         | cites parent; epic table |                 |
| 0255 | specs/0255-install-manage-link-typescript.delta-01.md        | implemented | 1.1.0   | #1334         | cites parent             |                 |
| 0255 | specs/0255-install-manage-link-typescript.md                 | implemented | 1.0.0   | #1334         | cites parent; epic table |                 |
| 0256 | specs/0256-setup-entry-points-typescript.md                  | implemented | 1.0.0   | #1335         | cites parent; epic table |                 |
| 0257 | specs/0257-packaging-release-typescript.md                   | implemented | 1.0.0   | #1336         | cites parent; epic table |                 |
| 0258 | specs/0258-skill-extension-bundled-scripts-typescript.md     | implemented | 1.0.0   | #1337         | cites parent; epic table |                 |
| 0259 | specs/0259-governance-checks-typescript.md                   | implemented | 1.0.0   | #1338         | cites parent             |                 |
| 0260 | specs/0260-hook-ops-tests-typescript.md                      | implemented | 1.0.0   | #1340         | cites parent             |                 |
| 0261 | specs/0261-e2e-harness-probes-typescript.md                  | implemented | 1.0.0   | #1342         | cites parent             |                 |
| 0262 | specs/0262-model-ci-tooling-typescript.md                    | implemented | 1.0.0   | #1339         | cites parent             |                 |
| 0263 | specs/0263-setup-service-tests-typescript.md                 | implemented | 1.0.0   | #1341         | cites parent             |                 |
| 0264 | specs/0264-windows-timing-budget-calibration.md              | implemented | 1.0.0   | #1509         | cites parent             |                 |
| 0265 | specs/0265-build-checks-tests-typescript.md                  | implemented | 1.0.0   | #1343         | cites parent             |                 |
| 0266 | specs/0266-final-removal-and-termination.md                  | implemented | 1.0.0   | #1344         | cites parent             |                 |

Spec paths named in the epic body table but not tracked: none.

## 2. Follow-up issues

Evidence: `#N` references in the bodies and comments of #1231 and #1344 (row tickets, #1231 and #1344 excluded), `gh issue list --search "1231 in:body" --state all`, one `gh api repos/crewrig/crewrig/issues/N` per candidate. Pull requests are listed apart.

Issues: 47 (open 4, closed 43, other 0); pull requests referenced: 187.

| issue | title                                                                                                                 | state  | owner (assignee)        | found by                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | ------------------------------------------------------- |
| #3    | 🔥 Remove ci-workflow-engineering from repo history                                                                   | closed | (none assigned)         | #1231 reference                                         |
| #4    | ✨ GitHub Actions skill, CI configurator agent, and CI debugger agent                                                 | closed | (none assigned)         | #1231 reference                                         |
| #961  | 📋 Findings ledger — deferred non-blocking findings                                                                   | open   | (none assigned)         | #1231 reference; #1344 reference                        |
| #1191 | 🏗️ Study migrating CrewRig shell scripts to a cross-platform language (Windows, macOS, Linux)                         | closed | @gfourny-sfeir          | #1231 reference                                         |
| #1192 | [IDEA] Target language for the shell-script migration — Python vs TypeScript vs Go (parent #1191)                     | closed | @hcross, @gfourny-sfeir | #1231 reference; search "1231 in:body"                  |
| #1210 | 🐛 Gemini setup rewrites settings.json from the template on every run, erasing operator settings and registered hooks | closed | @gfourny-sfeir          | #1231 reference                                         |
| #1314 | 🏗️ Shell to TypeScript — Sub-spec A: Foundations                                                                      | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1315 | 🏗️ Shell to TypeScript — Sub-spec B: Windows hook command lines                                                       | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1316 | 🏗️ Shell to TypeScript — Sub-spec C: Hooks and CLI integration points                                                 | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1317 | 🏗️ Shell to TypeScript — Sub-spec D: OS service management                                                            | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1318 | 🏗️ Shell to TypeScript — Sub-spec E: Symbolic links                                                                   | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1319 | 🏗️ Shell to TypeScript — Sub-spec F: Setup, install, manage and import                                                | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1320 | 🏗️ Shell to TypeScript — Sub-spec G: Build                                                                            | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1323 | 🏗️ Shell to TypeScript — Sub-spec H: Skill- and extension-bundled scripts                                             | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1325 | 🏗️ Shell to TypeScript — Sub-spec I: CI checks                                                                        | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1327 | 🏗️ Shell to TypeScript — Sub-spec J: Tests and final removal                                                          | closed | (none assigned)         | #1231 reference; search "1231 in:body"                  |
| #1364 | 🐛 Extension release writes a CHANGELOG.md that fails lint-markdown and breaks main                                   | closed | (none assigned)         | #1231 reference                                         |
| #1379 | 🐛 Release bot cannot push to main since ratchet and lint-typescript became required checks                           | closed | (none assigned)         | #1231 reference                                         |
| #1387 | 🤝 Define multi-contributor ticket-assignment conventions                                                             | closed | @hcross                 | search "1231 in:body"                                   |
| #1389 | 📏 Measure Antigravity CLI statusLine.command parsing on Windows (cli-matrix row 37e)                                 | closed | @hcross                 | #1231 reference; search "1231 in:body"                  |
| #1392 | 🔒 Wire the Antigravity CLI status line on Windows without a current-directory interpreter lookup                     | closed | @hcross                 | #1231 reference; search "1231 in:body"                  |
| #1398 | 🧪 Probe exit status 1 on the wired usage-capture events for Claude Code, Gemini CLI and Copilot CLI (spec 0243 R12)  | closed | @hcross                 | #1231 reference; search "1231 in:body"                  |
| #1400 | ⚡️ Bring implementation-PR CI wall-clock back toward the spec 0147 budget (EPIC)                                      | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1401 | 🐛 check-test-strays.sh runs every test suite in CI because the bare base ref never resolves                          | closed | @gfourny-sfeir          | search "1231 in:body"                                   |
| #1402 | 🐛 ci-changeset-coverage.sh diffs release/** pull requests against main                                               | closed | @gfourny-sfeir          | search "1231 in:body"                                   |
| #1405 | 🏗️ Replace the runtime changeset-coverage fail-safe with a static path-ownership check                                | closed | @gfourny-sfeir          | search "1231 in:body"                                   |
| #1422 | 🔍 Compare GitHub path filters with ci-capabilities.yml paths in check-ci-parity                                      | closed | @gfourny-sfeir          | #1231 reference                                         |
| #1432 | ⚡️ Find why build-components --check costs ~35 s on a one-agent emission root                                         | closed | @gfourny-sfeir          | #1231 reference                                         |
| #1437 | 💬 Make the spec 0243 R12 missing-dependency diagnostic visible on Copilot CLI and once per turn on Gemini CLI        | closed | @hcross                 | #1231 reference; search "1231 in:body"                  |
| #1438 | 🐛 Replace the machine paths in spec 0243 delta-03 that fail check-no-machine-paths on the release branch             | closed | @hcross                 | #1231 reference; search "1231 in:body"                  |
| #1440 | 🔍 Reconcile usage-pricing paths with the scripts its suite executes                                                  | closed | @gfourny-sfeir          | #1231 reference                                         |
| #1441 | 📝 Record the lifecycle status of spec 0243 and its deltas on the release branch                                      | closed | @hcross                 | #1231 reference; search "1231 in:body"                  |
| #1445 | ⚡️ Stop running changed test suites twice for the stray scan in test-wiring                                           | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1503 | 🐛 Remove the /home/u/ machine-path tokens that turned release/1231-ts-migration red after row C3                     | closed | @hcross                 | search "1231 in:body"                                   |
| #1508 | 🐛 Run the repository-wide scans of the misc capability on every change, not only when their own script changes       | closed | @hcross                 | search "1231 in:body"                                   |
| #1515 | 🐛 Remove the bash spawn of usage-mirror from the usage store (Windows parity gap, before J4)                         | closed | @gfourny-sfeir          | #1344 reference; search "1231 in:body"                  |
| #1545 | 🔒 Decide whether the MCP switch should abort when an assistant configuration cannot be backed up                     | closed | @gfourny-sfeir          | #1231 reference                                         |
| #1551 | 🔒 Fix the critical npm audit advisories before lock-only pull requests start failing                                 | closed | @hcross                 | search "1231 in:body"                                   |
| #1563 | 🔀 Sync main into release/1231-ts-migration after row F2                                                              | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1564 | 📝 Record the implemented status of spec 0243 delta-04 on the release branch                                          | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1599 | 🐛 Keep a workspace install's node_modules out of the extension release archive                                       | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1601 | 🔬 Measure the plugin-root hook command lines of the four CLIs on Windows (follow-up of #1337)                        | open   | (none assigned)         | #1231 reference; #1344 reference; search "1231 in:body" |
| #1611 | 🔧 Close the review ledger of row H (follow-up of #1337)                                                              | closed | @gfourny-sfeir          | #1231 reference; #1344 reference; search "1231 in:body" |
| #1612 | 🔀 Sync main into release/1231-ts-migration after rows G2 and H                                                       | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1614 | ♻️ Decouple the setup goldens from the real package-lock.json                                                         | closed | @gfourny-sfeir          | #1231 reference; search "1231 in:body"                  |
| #1693 | 🧪 Re-guard e2e-capture-versions and the publish-probe-verdict edge cases with TypeScript literal tests               | open   | @gfourny-sfeir          | #1344 reference; search "1231 in:body"                  |
| #1712 | 📝 Regenerate the rotate-token MemPalace diagram without the deleted switch-mempalace-http.sh name                    | open   | @gfourny-sfeir          | search "1231 in:body"                                   |

### Open follow-ups (accepted-gap candidates)

| issue | title                                                                                                   | owner (assignee) |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| #961  | 📋 Findings ledger — deferred non-blocking findings                                                     | (none assigned)  |
| #1601 | 🔬 Measure the plugin-root hook command lines of the four CLIs on Windows (follow-up of #1337)          | (none assigned)  |
| #1693 | 🧪 Re-guard e2e-capture-versions and the publish-probe-verdict edge cases with TypeScript literal tests | @gfourny-sfeir   |
| #1712 | 📝 Regenerate the rotate-token MemPalace diagram without the deleted switch-mempalace-http.sh name      | @gfourny-sfeir   |

Pull requests referenced (not follow-ups): #1239, #1355, #1356, #1357, #1359, #1362, #1365, #1376, #1380, #1381, #1383, #1384, #1385, #1386, #1388, #1390, #1391, #1393, #1395, #1396, #1399, #1408, #1409, #1411, #1412, #1414, #1415, #1418, #1419, #1420, #1423, #1424, #1425, #1428, #1430, #1431, #1433, #1434, #1435, #1436, #1439, #1442, #1443, #1444, #1446, #1447, #1448, #1449, #1450, #1451, #1452, #1453, #1455, #1457, #1458, #1459, #1460, #1470, #1471, #1476, #1479, #1480, #1482, #1483, #1486, #1487, #1490, #1491, #1492, #1496, #1497, #1500, #1502, #1504, #1505, #1506, #1507, #1511, #1512, #1513, #1514, #1516, #1517, #1518, #1520, #1521, #1522, #1524, #1525, #1527, #1528, #1529, #1530, #1531, #1532, #1533, #1534, #1535, #1536, #1537, #1538, #1539, #1540, #1541, #1542, #1543, #1544, #1546, #1548, #1549, #1550, #1552, #1553, #1554, #1555, #1556, #1557, #1558, #1559, #1560, #1561, #1562, #1565, #1566, #1567, #1568, #1569, #1570, #1571, #1572, #1573, #1574, #1575, #1576, #1577, #1578, #1579, #1580, #1581, #1582, #1583, #1584, #1586, #1587, #1588, #1589, #1590, #1591, #1592, #1593, #1594, #1595, #1596, #1597, #1598, #1600, #1602, #1603, #1604, #1605, #1606, #1607, #1608, #1609, #1610, #1613, #1633, #1637, #1675, #1680, #1683, #1684, #1685, #1688, #1689, #1690, #1692, #1694, #1698, #1699, #1702, #1704, #1706, #1708, #1711, #1713, #1714.

## 3. Accepted gaps

### Gap A: #1601, Windows plugin-root hook measurement (`docs/cli-matrix.md` row 37g)

| CLI             | cell, verbatim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | ❓ **NOT MEASURED** — target form `node "${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.ts"` (Git Bash on Windows, row 37); whether `${CLAUDE_PLUGIN_ROOT}` expands in a plugin hook command on Windows is open (#1601).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gemini CLI      | ❓ **NOT MEASURED** — target form `node "${extensionPath}/hooks/<hook>.ts"` (Windows PowerShell 5.1, row 37); whether Gemini CLI expands `${extensionPath}` there is open (#1601); row 37c recorded that it does not expand `${GEMINI_PROJECT_DIR}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Copilot CLI     | ❓ **NOT MEASURED** — target form `node "${COPILOT_PLUGIN_ROOT}/hooks/<hook>.ts"` (Windows PowerShell 5.1, `command` key, row 37); whether `${COPILOT_PLUGIN_ROOT}` expands there is open (#1601).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Antigravity CLI | ❓ **NOT MEASURED** — target form the plugin-relative `node "hooks/<hook>.ts"` (`cmd.exe`, rows 37 and 37e). On a `win32` build host (`ctx.platform`) the builder writes the guarded line `set NoDefaultCurrentDirectoryInExePath=1&& node "hooks/<hook>.ts"` (`GUARDED_PREFIX` of `scripts/lib/hook-command.ts`; spec 0258 delta-01 R17), because `cmd.exe` looks a bare `node` up in the working directory before `PATH` (CWE-427); on every other platform the line stays the bare form. Row 37f measured that prefix holding in front of an **unquoted absolute** script path; the working directory of an Antigravity **plugin** hook and the behaviour of the **quoted plugin-relative** remainder `node "hooks/<hook>.ts"` under `cmd.exe` stay **NOT MEASURED** (#1601), and the guard applies whichever directory it is. |

Evidence: the four cells above, copied from the file at audit time. Owner: the maintainer with a Windows machine (spec 0266 R19); forge assignee: (none assigned on the forge). Issue: #1601 (open, 🔬 Measure the plugin-root hook command lines of the four CLIs on Windows (follow-up of #1337)).

### Gap B: `docs/cli-matrix.md` row 42, missing-hook behaviour

| CLI             | cell, verbatim                                                                                                                                                                                                                                                              | NOT MEASURED |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Claude Code     | ❓ **NOT MEASURED** — follow-up to be opened by the coordinator.                                                                                                                                                                                                            | yes          |
| Gemini CLI      | ❓ **NOT MEASURED** — follow-up to be opened by the coordinator.                                                                                                                                                                                                            | yes          |
| Copilot CLI     | ❓ **NOT MEASURED** — only repo evidence: its `preToolUse` is fail-closed, so a missing guard script fails every tool call (see the row 29 [GAP] note on the guard registration); transcript and usage-capture lines unmeasured, follow-up to be opened by the coordinator. | yes          |
| Antigravity CLI | ❓ **NOT MEASURED** — follow-up to be opened by the coordinator.                                                                                                                                                                                                            | yes          |

Evidence: 4 of 4 cells read NOT MEASURED. Owner: not assigned in the repository (the cells say "follow-up to be opened by the coordinator"; no owner is invented here). Issue: none cited in the row.

### Gap C: #1693

Issue 1693 is open: 🧪 Re-guard e2e-capture-versions and the publish-probe-verdict edge cases with TypeScript literal tests. Owner (forge assignee): @gfourny-sfeir. Evidence: `gh api repos/crewrig/crewrig/issues/1693` at audit time.

Self-check: PASSED (no row 37g cell reads measured).

## 4. Proof that no shell entry point remains

### 4a. Tracked shell files

Evidence: `git ls-files -z` over 6888 tracked files; suffix `.sh` and a first line `#!` naming bash, sh, zsh, dash or ksh.

Counts: `*.sh` 0; shebang without the suffix 0; total 0.

No tracked shell file.

### 4b. Allowlist

`ci/shell-allowlist.txt` entries (non-blank, non-comment lines): 0.

### 4c. Shell-word scan of the invocation surfaces

Scope: `hooks/*.json`, `Taskfile.yml`, `.github/workflows/*`, `.gitlab-ci.yml`, `ci/**`, `docs/**`, `README.md`, `AGENTS.md`, every `SKILL.md`, `AGENT.md` and `FORMAT.md` (tracked files, including built copies). Patterns: the word `bash` or `sh` followed by a space; the suffix `.sh`.

Auto-classification rules (a hit no rule matches stays UNCLASSIFIED until a human classifies it):

- H1: any line of docs/shell-removal.md (the migration table naming removed paths)
- H2: any line under specs/ (specs are historical records)
- H3: a line that states a removal (removed, deleted, retired, formerly, previously, replaced, superseded, legacy, no longer, migrated) and names the shell word or .sh path inside backticks or double quotes
- H4: ci/shell-allowlist.txt, the ratchet's own list of paths (data, not an invocation)
- H5: any line under docs/adr/, docs/design/ or docs/research/ (accepted ADRs, design notes and research traces are historical records, never rewritten)
- H6: a line of the github-actions or gitlab-ci skill (source or built copy) that is exactly one of: `- run: ./scripts/deploy.sh`, `- ./scripts/deploy.sh`, `script: [./publish.sh dist/]` (generic examples for an adopter's own pipeline)
- H7: a runbook line that quotes the concrete legacy path `dist/stub.sh` of docs/runbooks/extension-mcp-token-probe.md (the probe's stub fixture)
- H8: a line naming a third-party installer URL (taskfile.dev/install.sh, the NodeSource setup_24.x script, Homebrew install.sh, brew.sh, scoop.sh, get.scoop.sh, astral.sh uv install.sh)
- H9: a line naming a machine-local generated file: ~/.crewrig/tls-env.sh or ~/.crewrig/mcp-daemon-launcher.sh
- H10: the image-generation prompt docs/assets/mempalace-mcp/rotate-token.prompt.md (its box text is the PNG source, tracked in #1712)
- H11: a docs/cli-matrix.md line recording a third-party CLI's own shell behaviour: `bash.exe` (Git for Windows) or `/bin/sh -c '<registered command>'`

Hits: 447; historical (auto) 447; UNCLASSIFIED 0.

Rows of the hit table (447, each with file:line, kind, rule and text) are not reproduced here: the
tool that generated them lives on branch `test/1344-audit-tool` (`scripts/audit-termination.ts`, not part of
the release) and the full table is attached to the #1344 comment that links this page. Hits per rule:
H1 115, H3 64, H5 222, H6 15, H7 7, H8 11, H9 11, H10 1, H11 1 (H2 and H4: 0).

## 5. Termination checklist (parent requirement 25)

| condition                                                                                              | verdict                                                                                 | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ratchet allowlist is empty                                                                             | MET                                                                                     | `ci/shell-allowlist.txt` has 0 entries (4b).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| No tracked shell script exists                                                                         | MET                                                                                     | 0 tracked files match `*.sh` or a shell shebang (4a).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| No hook, CLI integration point, Taskfile task, workflow step, doc page or skill invokes a shell script | MET                                                                                     | all 447 hits of 4c carry an auto-classification rule; a reviewer still reads the rule set.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Every sub-spec carries `status: implemented`                                                           | MET for every sub-spec; parent and two deltas pending the final merge                   | Sub-specs 0237 to 0266 and the deltas 01 to 03 and 05 of 0215 read `implemented` (section 1; 0238, 0240 and delta-01 of 0215 flipped in this pull request). The parent `specs/0215-shell-to-typescript-migration.md`, its delta-04 (release-branch regime, requirement 37 sunsets at the final merge) and delta-06 (merge commit of the final merge) are not sub-specs and read `approved`: they flip to `implemented` in the commit that follows the final merge, which is when their conditions become true. Not claimed before. |
| Every migrated user-facing entry point has a green `windows-latest` job                                | MET at the last full run; re-verified on the release head before the final pull request | The 24 `windows-*` jobs of `.github/workflows/build.yml` all concluded `success` in run 39115879436 (pull request #1715 head `6011cc66`, 94 of 94 checks), the last full run before the final slice. The final release-to-main pull request body records the run of the release head after this slice merges. Accepted gap: the Windows plugin-root hook measurement of #1601 (section 3, gap A) is not a migrated-entry-point job and stays NOT MEASURED.                                                                         |

## 6. Sync recovery rehearsal

Clone: `git clone --no-local` of the audited repository into a `mkdtemp` directory (removed afterwards); remote-tracking refs fetched from the local repository, no network, no push. Merge rehearsal: ON.

| check                                                                    | result | detail                           |
| ------------------------------------------------------------------------ | ------ | -------------------------------- |
| cad08ac64d is an ancestor of origin/release/1231-ts-migration            | PASS   | exit 0                           |
| 3ef0e4d03c is an ancestor of origin/release/1231-ts-migration            | PASS   | exit 0                           |
| scripts/sync-from-upstream.sh exists at cad08ac64d                       | PASS   | exit 0                           |
| local merge of origin/release/1231-ts-migration into origin/main         | PASS   | checkout exit 0, merge exit 0    |
| cad08ac64d is an ancestor of the merge result                            | PASS   | exit 0                           |
| 3ef0e4d03c is an ancestor of the merge result                            | PASS   | exit 0                           |
| checkout cad08ac64d -- scripts/sync-from-upstream.sh restores shell text | PASS   | exit 0, first line `#!/bin/bash` |

Rehearsal: ALL PASS.

## Command log

```text
git rev-parse HEAD
git ls-files specs
gh issue view 1231 --repo crewrig/crewrig --json body
gh issue view 1231 --repo crewrig/crewrig --json body,comments
gh issue view 1344 --repo crewrig/crewrig --json body,comments
gh issue list --repo crewrig/crewrig --search 1231 in:body --state all --limit 200 --json number,title,state,assignees
gh api repos/crewrig/crewrig/issues/3
gh api repos/crewrig/crewrig/issues/4
gh api repos/crewrig/crewrig/issues/961
gh api repos/crewrig/crewrig/issues/1191
gh api repos/crewrig/crewrig/issues/1192
gh api repos/crewrig/crewrig/issues/1210
gh api repos/crewrig/crewrig/issues/1239
gh api repos/crewrig/crewrig/issues/1314
gh api repos/crewrig/crewrig/issues/1315
gh api repos/crewrig/crewrig/issues/1316
gh api repos/crewrig/crewrig/issues/1317
gh api repos/crewrig/crewrig/issues/1318
gh api repos/crewrig/crewrig/issues/1319
gh api repos/crewrig/crewrig/issues/1320
gh api repos/crewrig/crewrig/issues/1323
gh api repos/crewrig/crewrig/issues/1325
gh api repos/crewrig/crewrig/issues/1327
gh api repos/crewrig/crewrig/issues/1355
gh api repos/crewrig/crewrig/issues/1356
gh api repos/crewrig/crewrig/issues/1357
gh api repos/crewrig/crewrig/issues/1359
gh api repos/crewrig/crewrig/issues/1362
gh api repos/crewrig/crewrig/issues/1364
gh api repos/crewrig/crewrig/issues/1365
gh api repos/crewrig/crewrig/issues/1376
gh api repos/crewrig/crewrig/issues/1379
gh api repos/crewrig/crewrig/issues/1380
gh api repos/crewrig/crewrig/issues/1381
gh api repos/crewrig/crewrig/issues/1383
gh api repos/crewrig/crewrig/issues/1384
gh api repos/crewrig/crewrig/issues/1385
gh api repos/crewrig/crewrig/issues/1386
gh api repos/crewrig/crewrig/issues/1387
gh api repos/crewrig/crewrig/issues/1388
gh api repos/crewrig/crewrig/issues/1389
gh api repos/crewrig/crewrig/issues/1390
gh api repos/crewrig/crewrig/issues/1391
gh api repos/crewrig/crewrig/issues/1392
gh api repos/crewrig/crewrig/issues/1393
gh api repos/crewrig/crewrig/issues/1395
gh api repos/crewrig/crewrig/issues/1396
gh api repos/crewrig/crewrig/issues/1398
gh api repos/crewrig/crewrig/issues/1399
gh api repos/crewrig/crewrig/issues/1400
gh api repos/crewrig/crewrig/issues/1401
gh api repos/crewrig/crewrig/issues/1402
gh api repos/crewrig/crewrig/issues/1405
gh api repos/crewrig/crewrig/issues/1408
gh api repos/crewrig/crewrig/issues/1409
gh api repos/crewrig/crewrig/issues/1411
gh api repos/crewrig/crewrig/issues/1412
gh api repos/crewrig/crewrig/issues/1414
gh api repos/crewrig/crewrig/issues/1415
gh api repos/crewrig/crewrig/issues/1418
gh api repos/crewrig/crewrig/issues/1419
gh api repos/crewrig/crewrig/issues/1420
gh api repos/crewrig/crewrig/issues/1422
gh api repos/crewrig/crewrig/issues/1423
gh api repos/crewrig/crewrig/issues/1424
gh api repos/crewrig/crewrig/issues/1425
gh api repos/crewrig/crewrig/issues/1428
gh api repos/crewrig/crewrig/issues/1430
gh api repos/crewrig/crewrig/issues/1431
gh api repos/crewrig/crewrig/issues/1432
gh api repos/crewrig/crewrig/issues/1433
gh api repos/crewrig/crewrig/issues/1434
gh api repos/crewrig/crewrig/issues/1435
gh api repos/crewrig/crewrig/issues/1436
gh api repos/crewrig/crewrig/issues/1437
gh api repos/crewrig/crewrig/issues/1438
gh api repos/crewrig/crewrig/issues/1439
gh api repos/crewrig/crewrig/issues/1440
gh api repos/crewrig/crewrig/issues/1441
gh api repos/crewrig/crewrig/issues/1442
gh api repos/crewrig/crewrig/issues/1443
gh api repos/crewrig/crewrig/issues/1444
gh api repos/crewrig/crewrig/issues/1445
gh api repos/crewrig/crewrig/issues/1446
gh api repos/crewrig/crewrig/issues/1447
gh api repos/crewrig/crewrig/issues/1448
gh api repos/crewrig/crewrig/issues/1449
gh api repos/crewrig/crewrig/issues/1450
gh api repos/crewrig/crewrig/issues/1451
gh api repos/crewrig/crewrig/issues/1452
gh api repos/crewrig/crewrig/issues/1453
gh api repos/crewrig/crewrig/issues/1455
gh api repos/crewrig/crewrig/issues/1457
gh api repos/crewrig/crewrig/issues/1458
gh api repos/crewrig/crewrig/issues/1459
gh api repos/crewrig/crewrig/issues/1460
gh api repos/crewrig/crewrig/issues/1470
gh api repos/crewrig/crewrig/issues/1471
gh api repos/crewrig/crewrig/issues/1476
gh api repos/crewrig/crewrig/issues/1479
gh api repos/crewrig/crewrig/issues/1480
gh api repos/crewrig/crewrig/issues/1482
gh api repos/crewrig/crewrig/issues/1483
gh api repos/crewrig/crewrig/issues/1486
gh api repos/crewrig/crewrig/issues/1487
gh api repos/crewrig/crewrig/issues/1490
gh api repos/crewrig/crewrig/issues/1491
gh api repos/crewrig/crewrig/issues/1492
gh api repos/crewrig/crewrig/issues/1496
gh api repos/crewrig/crewrig/issues/1497
gh api repos/crewrig/crewrig/issues/1500
gh api repos/crewrig/crewrig/issues/1502
gh api repos/crewrig/crewrig/issues/1503
gh api repos/crewrig/crewrig/issues/1504
gh api repos/crewrig/crewrig/issues/1505
gh api repos/crewrig/crewrig/issues/1506
gh api repos/crewrig/crewrig/issues/1507
gh api repos/crewrig/crewrig/issues/1508
gh api repos/crewrig/crewrig/issues/1511
gh api repos/crewrig/crewrig/issues/1512
gh api repos/crewrig/crewrig/issues/1513
gh api repos/crewrig/crewrig/issues/1514
gh api repos/crewrig/crewrig/issues/1515
gh api repos/crewrig/crewrig/issues/1516
gh api repos/crewrig/crewrig/issues/1517
gh api repos/crewrig/crewrig/issues/1518
gh api repos/crewrig/crewrig/issues/1520
gh api repos/crewrig/crewrig/issues/1521
gh api repos/crewrig/crewrig/issues/1522
gh api repos/crewrig/crewrig/issues/1524
gh api repos/crewrig/crewrig/issues/1525
gh api repos/crewrig/crewrig/issues/1527
gh api repos/crewrig/crewrig/issues/1528
gh api repos/crewrig/crewrig/issues/1529
gh api repos/crewrig/crewrig/issues/1530
gh api repos/crewrig/crewrig/issues/1531
gh api repos/crewrig/crewrig/issues/1532
gh api repos/crewrig/crewrig/issues/1533
gh api repos/crewrig/crewrig/issues/1534
gh api repos/crewrig/crewrig/issues/1535
gh api repos/crewrig/crewrig/issues/1536
gh api repos/crewrig/crewrig/issues/1537
gh api repos/crewrig/crewrig/issues/1538
gh api repos/crewrig/crewrig/issues/1539
gh api repos/crewrig/crewrig/issues/1540
gh api repos/crewrig/crewrig/issues/1541
gh api repos/crewrig/crewrig/issues/1542
gh api repos/crewrig/crewrig/issues/1543
gh api repos/crewrig/crewrig/issues/1544
gh api repos/crewrig/crewrig/issues/1545
gh api repos/crewrig/crewrig/issues/1546
gh api repos/crewrig/crewrig/issues/1548
gh api repos/crewrig/crewrig/issues/1549
gh api repos/crewrig/crewrig/issues/1550
gh api repos/crewrig/crewrig/issues/1551
gh api repos/crewrig/crewrig/issues/1552
gh api repos/crewrig/crewrig/issues/1553
gh api repos/crewrig/crewrig/issues/1554
gh api repos/crewrig/crewrig/issues/1555
gh api repos/crewrig/crewrig/issues/1556
gh api repos/crewrig/crewrig/issues/1557
gh api repos/crewrig/crewrig/issues/1558
gh api repos/crewrig/crewrig/issues/1559
gh api repos/crewrig/crewrig/issues/1560
gh api repos/crewrig/crewrig/issues/1561
gh api repos/crewrig/crewrig/issues/1562
gh api repos/crewrig/crewrig/issues/1563
gh api repos/crewrig/crewrig/issues/1564
gh api repos/crewrig/crewrig/issues/1565
gh api repos/crewrig/crewrig/issues/1566
gh api repos/crewrig/crewrig/issues/1567
gh api repos/crewrig/crewrig/issues/1568
gh api repos/crewrig/crewrig/issues/1569
gh api repos/crewrig/crewrig/issues/1570
gh api repos/crewrig/crewrig/issues/1571
gh api repos/crewrig/crewrig/issues/1572
gh api repos/crewrig/crewrig/issues/1573
gh api repos/crewrig/crewrig/issues/1574
gh api repos/crewrig/crewrig/issues/1575
gh api repos/crewrig/crewrig/issues/1576
gh api repos/crewrig/crewrig/issues/1577
gh api repos/crewrig/crewrig/issues/1578
gh api repos/crewrig/crewrig/issues/1579
gh api repos/crewrig/crewrig/issues/1580
gh api repos/crewrig/crewrig/issues/1581
gh api repos/crewrig/crewrig/issues/1582
gh api repos/crewrig/crewrig/issues/1583
gh api repos/crewrig/crewrig/issues/1584
gh api repos/crewrig/crewrig/issues/1586
gh api repos/crewrig/crewrig/issues/1587
gh api repos/crewrig/crewrig/issues/1588
gh api repos/crewrig/crewrig/issues/1589
gh api repos/crewrig/crewrig/issues/1590
gh api repos/crewrig/crewrig/issues/1591
gh api repos/crewrig/crewrig/issues/1592
gh api repos/crewrig/crewrig/issues/1593
gh api repos/crewrig/crewrig/issues/1594
gh api repos/crewrig/crewrig/issues/1595
gh api repos/crewrig/crewrig/issues/1596
gh api repos/crewrig/crewrig/issues/1597
gh api repos/crewrig/crewrig/issues/1598
gh api repos/crewrig/crewrig/issues/1599
gh api repos/crewrig/crewrig/issues/1600
gh api repos/crewrig/crewrig/issues/1601
gh api repos/crewrig/crewrig/issues/1602
gh api repos/crewrig/crewrig/issues/1603
gh api repos/crewrig/crewrig/issues/1604
gh api repos/crewrig/crewrig/issues/1605
gh api repos/crewrig/crewrig/issues/1606
gh api repos/crewrig/crewrig/issues/1607
gh api repos/crewrig/crewrig/issues/1608
gh api repos/crewrig/crewrig/issues/1609
gh api repos/crewrig/crewrig/issues/1610
gh api repos/crewrig/crewrig/issues/1611
gh api repos/crewrig/crewrig/issues/1612
gh api repos/crewrig/crewrig/issues/1613
gh api repos/crewrig/crewrig/issues/1614
gh api repos/crewrig/crewrig/issues/1633
gh api repos/crewrig/crewrig/issues/1637
gh api repos/crewrig/crewrig/issues/1675
gh api repos/crewrig/crewrig/issues/1680
gh api repos/crewrig/crewrig/issues/1683
gh api repos/crewrig/crewrig/issues/1684
gh api repos/crewrig/crewrig/issues/1685
gh api repos/crewrig/crewrig/issues/1688
gh api repos/crewrig/crewrig/issues/1689
gh api repos/crewrig/crewrig/issues/1690
gh api repos/crewrig/crewrig/issues/1692
gh api repos/crewrig/crewrig/issues/1693
gh api repos/crewrig/crewrig/issues/1694
gh api repos/crewrig/crewrig/issues/1698
gh api repos/crewrig/crewrig/issues/1699
gh api repos/crewrig/crewrig/issues/1702
gh api repos/crewrig/crewrig/issues/1704
gh api repos/crewrig/crewrig/issues/1706
gh api repos/crewrig/crewrig/issues/1708
gh api repos/crewrig/crewrig/issues/1711
gh api repos/crewrig/crewrig/issues/1712
gh api repos/crewrig/crewrig/issues/1713
gh api repos/crewrig/crewrig/issues/1714
gh api repos/crewrig/crewrig/issues/1601
gh api repos/crewrig/crewrig/issues/1693
git ls-files -z
git clone --no-local --quiet /Users/guillaumefourny/orca/workspaces/crewrig/j4-1344-final-removal/.worktrees/s6 /private/var/folders/65/gv2_h9k15db6fh8y0pv46r4r0000gp/T/audit-termination-dkWdeo/clone
git fetch --quiet /Users/guillaumefourny/orca/workspaces/crewrig/j4-1344-final-removal/.worktrees/s6 +refs/remotes/origin/*:refs/remotes/origin/*
git merge-base --is-ancestor cad08ac64d30dcd3ed96b4aadaf156ed7673abae origin/release/1231-ts-migration
git merge-base --is-ancestor 3ef0e4d03c443736efe75a659a0751478ab377a8 origin/release/1231-ts-migration
git cat-file -e cad08ac64d30dcd3ed96b4aadaf156ed7673abae:scripts/sync-from-upstream.sh
git checkout --quiet --detach origin/main
git -c user.name=audit-rehearsal -c user.email=audit-rehearsal@example.invalid merge --no-ff --no-edit -m rehearsal merge (local, never pushed) origin/release/1231-ts-migration
git merge-base --is-ancestor cad08ac64d30dcd3ed96b4aadaf156ed7673abae HEAD
git merge-base --is-ancestor 3ef0e4d03c443736efe75a659a0751478ab377a8 HEAD
git checkout cad08ac64d30dcd3ed96b4aadaf156ed7673abae -- scripts/sync-from-upstream.sh
```
