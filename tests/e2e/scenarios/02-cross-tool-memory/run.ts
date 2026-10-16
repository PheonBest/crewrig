// tests/e2e/scenarios/02-cross-tool-memory/run.ts — thin entry; the logic is in
// tests/e2e/lib/scenario-02-cross-tool-memory.ts (twin of run.sh).
import { runScenario02 } from "../../lib/scenario-02-cross-tool-memory.ts";

const env = process.env;
void runScenario02(env).then((r) => {
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.status;
});
