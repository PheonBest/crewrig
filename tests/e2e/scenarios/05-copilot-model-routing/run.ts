// tests/e2e/scenarios/05-copilot-model-routing/run.ts — thin entry; the logic is in
// tests/e2e/lib/scenario-05-copilot-model-routing.ts (twin of run.sh).
import { runScenario05 } from "../../lib/scenario-05-copilot-model-routing.ts";

const env = process.env;
const r = runScenario05(env, process.cwd());
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.status;
