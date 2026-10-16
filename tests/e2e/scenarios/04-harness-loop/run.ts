// tests/e2e/scenarios/04-harness-loop/run.ts — thin entry; the logic is in
// tests/e2e/lib/scenario-04-harness-loop.ts (twin of run.sh).
import { runScenario04 } from "../../lib/scenario-04-harness-loop.ts";

const env = process.env;
void runScenario04(env).then((r) => {
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.status;
});
