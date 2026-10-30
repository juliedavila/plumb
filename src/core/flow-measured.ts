// The tracker's measured flow for an instance, computed once per loaded instance (the build and every patch impact
// read it). Absent when the instance has no tracker; present with available: false and the reason when the tracker
// cannot measure (no flow mapping, no status history).

import type { FlowMeasured, Instance } from "../types.ts";
import { measureFlow } from "../tracker/flow.ts";

const cache = new WeakMap<Instance, FlowMeasured | undefined>();

export function instanceMeasured(inst: Instance): FlowMeasured | undefined {
  if (cache.has(inst)) return cache.get(inst);
  const t = inst.tracker;
  const m = t?.issues ? measureFlow(t.issues, t.mapping, inst.model) : undefined;
  cache.set(inst, m);
  return m;
}
