// scenarios/01-layered-context/run.ts — thin entry; the logic lives in lib/scenario-01-layered-context.ts.
import { runScenario01 } from "../../lib/scenario-01-layered-context.ts";

const out = await runScenario01(process.env, process.cwd());
process.stdout.write(out.stdout);
process.stderr.write(out.stderr);
process.exitCode = out.status;
