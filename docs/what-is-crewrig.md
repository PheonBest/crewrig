# What is CrewRig?

<!-- crewrig-doc: published=false -->

<!-- Extracted verbatim from AGENTS.md lines 7-29. Cross-references to other sections refer to that file. -->

CrewRig is a centralized configuration framework for Gemini CLI, Claude Code,
GitHub Copilot CLI, and Antigravity CLI. Any agent loading this file should
understand these five pillars without needing to read README.md or ADRs:

1. **Layered context system engineering** — 00–60 priority files deployed to
   CLI user directories (`~/.gemini/`, `~/.claude/rules/`,
   `~/.copilot/instructions/`, `~/.gemini/antigravity-cli/`) that shape how AI
   assistants behave for a specific user's role, team, and seniority.
2. **Shared cross-tool memory** — MemPalace provides persistent agent memory
   accessible across tools and sessions, enabling continuity between Gemini
   CLI, Claude Code, Copilot CLI, and Antigravity CLI.
3. **Skill/agent/command creation and sharing** — `artifacts/` is the
   single-source zone where skills, agents, and commands are authored once;
   `scripts/build-components.ts` compiles them into outputs for all four CLIs.
4. **Harness engineering** — a built-in feedback loop where agents invoke the
   `harness-report` skill to tag frictions during real work, and the
   `harness-curator` skill clusters those frictions into actionable GitHub
   issues.
5. **Multi-CLI parity** — features are implemented symmetrically across Claude
   Code, Gemini CLI, GitHub Copilot CLI, and Antigravity CLI. Silent asymmetry
   is prohibited; every parity gap requires concrete evidence that the missing
   mechanism does not exist in the target CLI.
