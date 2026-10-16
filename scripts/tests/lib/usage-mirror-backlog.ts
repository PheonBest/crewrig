// usage-mirror-backlog.ts — the poisoned-plus-healthy pending backlog shared by the
// breaker cases of the mirror suites (Bash cases (j), "breaker cap removed" and
// "touchPendingMarkerMtime removed"): 3 chronically failing records ahead of 2 healthy
// ones, laid out by pinned marker mtimes, never by wall-clock creation order.

import {
  type Rig,
  pendingPath,
  mirroredPath,
  setMarkerMtime,
  sourceToolFailure,
  writeRecord,
} from "./usage-mirror-rig.ts";
import { seedOpts } from "./usage-mirror-records.ts";
import fs from "node:fs";

export interface Backlog {
  cli: string;
  period: string;
  poison: string[];
  healthy: string[];
}

const POISON_BASE_MS = 100_000_000_000; // far in the past
const HEALTHY_BASE_MS = 100_001_000_000; // later, still far in the past

export async function seedBacklog(rig: Rig, cli: string, instant: string): Promise<Backlog> {
  const period = instant.slice(0, 7);
  const poison = seedOpts("poison", cli, instant, 3).map((o) => writeRecord(o));
  const healthy = seedOpts("healthy", cli, instant, 2).map((o) => writeRecord(o));
  poison.forEach((rid, i) =>
    setMarkerMtime(pendingPath(rig, cli, period, rid), POISON_BASE_MS + (i + 1) * 1000),
  );
  healthy.forEach((rid, i) =>
    setMarkerMtime(pendingPath(rig, cli, period, rid), HEALTHY_BASE_MS + (i + 1) * 1000),
  );
  await sourceToolFailure(rig, "mempalace_add_drawer", "success-false", poison);
  return { cli, period, poison, healthy };
}

export const allMirrored = (rig: Rig, b: Backlog, rids: string[]): boolean =>
  rids.every((rid) => fs.existsSync(mirroredPath(rig, b.cli, b.period, rid)));

export const allPending = (rig: Rig, b: Backlog, rids: string[]): boolean =>
  rids.every(
    (rid) =>
      fs.existsSync(pendingPath(rig, b.cli, b.period, rid)) &&
      !fs.existsSync(mirroredPath(rig, b.cli, b.period, rid)),
  );
