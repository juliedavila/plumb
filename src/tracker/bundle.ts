// The tracker part of the bundle: an inventory summary, the mapping, and the reconciliation of the compiled plan
// (which carries each linked unit's tracker state). Additive: a bundle without a tracker has no `tracker` key.

import type { BundleTracker, Model, Plan, TrackerInput } from "../types.ts";
import { reconcile } from "./reconcile.ts";
import { isOrgMapping } from "./mapping.ts";

export function bundleTracker(t: TrackerInput, model: Model, plan: Plan): BundleTracker {
  const inv = t.inventory;
  const out: BundleTracker = { adapter: t.mapping?.adapter ?? inv?.adapter ?? "unknown" };
  if (inv) out.inventory = {
    ...(inv.flavor ? { flavor: inv.flavor } : {}), issues: inv.issues,
    projects: inv.projects, hierarchy: inv.hierarchy, issueTypes: inv.issueTypes.length,
    fields: inv.fields.map((f) => ({ id: f.id, name: f.name, role: f.role, count: f.count })),
    linkTypes: inv.linkTypes, statuses: inv.statuses,
    components: inv.components.length, labels: inv.labels.length, fixVersions: inv.fixVersions.length, notes: inv.notes,
  };
  if (t.mapping) out.mapping = t.mapping;
  const latest = (t.issues ?? []).map((i) => i.updated).filter((u): u is string => !!u).sort().pop();
  if (latest) out.latestUpdate = latest;
  if (t.mapping && t.issues && !isOrgMapping(t.mapping)) { // an org mapping measures standing work; it lines up no units
    out.reconcile = reconcile({ model, plan, mapping: t.mapping, issues: t.issues, links: t.links, ...(t.namespace ? { namespace: t.namespace } : {}) });
    const r = out.reconcile;
    const keys = new Set<string>([...r.proposed.map((p) => p.issue), ...r.linked.map((l) => l.issue), ...r.issuesWithoutUnit.map((i) => i.issue),
      ...r.statusDisagreements.map((d) => d.issue), ...r.phaseDisagreements.map((d) => d.issue), ...r.dependencyOneSided.flatMap((d) => [d.issue, d.dependsOnIssue])]);
    const info: NonNullable<BundleTracker["issueInfo"]> = {};
    for (const i of t.issues) if (keys.has(i.key)) info[i.key] = { summary: i.summary, status: i.status, type: i.type, ...(i.parent ? { parent: i.parent } : {}) };
    out.issueInfo = info;
  }
  return out;
}
