// scenarios/06-agent-surface-consumption/run.ts — thin entry; the logic lives in lib/scenario-06-agent-surface.ts.
import { runScenario06 } from "../../lib/scenario-06-agent-surface.ts";

const out = runScenario06(process.env, process.cwd());
process.stdout.write(out.stdout);
process.stderr.write(out.stderr);
process.exitCode = out.status;
