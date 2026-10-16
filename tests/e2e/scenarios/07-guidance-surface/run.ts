// tests/e2e/scenarios/07-guidance-surface/run.ts — thin entry; the logic is in
// tests/e2e/lib/scenario-07-guidance-surface.ts (twin of run.sh).
import { runScenario07 } from "../../lib/scenario-07-guidance-surface.ts";

const r = runScenario07(process.env, process.cwd());
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.status;
