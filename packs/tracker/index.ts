// tracker: the plan against the organization's tracker. The model owns structure and the tracker owns live state,
// so this pack never changes a unit; it reports where the two disagree, and where the mapping that joins them
// names something the tracker does not have.
//
// Reads ctx.tracker (loaded from <instance>/tracker/ by src/tracker/load.ts). Without a tracker directory it
// reports nothing.
//
// A shared root's tracker holds an org mapping (kind: org), which measures the teams' standing
// work rather than lining up units: the root's own build runs this pack over it. mapping-matches-inventory and
// mapping-covers check it against the inventory and the org layer (src/tracker/validate.ts validateOrgMapping), and the
// unit and milestone rules, which read the reconciliation, skip it.

import type { Finding, Rule, RuleContext, RulePack, TrackerReconcile } from "../../src/types.ts";
import { reconcile } from "../../src/tracker/reconcile.ts";
import { validateMapping, validateOrgMapping, type MappingProblem } from "../../src/tracker/validate.ts";
import { isOrgMapping } from "../../src/tracker/mapping.ts";
import { SETTLE, type SettleGuide } from "../../src/tracker/settle.ts";

/** A rule's "how": the condition that makes its finding appear, and how a person settles it (src/tracker/settle.ts). */
const how = (...gs: SettleGuide[]) => gs.map((g) => `It appears when: ${g.appears} To settle it: ${g.settle}`).join(" ");

type F = Omit<Finding, "pack" | "rule" | "severity">;
const memo = new WeakMap<object, TrackerReconcile | null>();

/** Reconciliation for this context's compiled plan, computed once per plan object. None for an org mapping, which lines up no units. */
export function reconcileFor(ctx: RuleContext): TrackerReconcile | undefined {
  const t = ctx.tracker;
  if (!t?.mapping || !t.issues || isOrgMapping(t.mapping) || ctx.root) return undefined; // a root lines up no units
  if (!memo.has(ctx.plan)) {
    const namespace = t.namespace ?? ctx.ns?.own;
    try { memo.set(ctx.plan, reconcile({ model: ctx.model, plan: ctx.plan, mapping: t.mapping, issues: t.issues, links: t.links, ...(namespace ? { namespace } : {}) })); }
    catch { memo.set(ctx.plan, null); }
  }
  return memo.get(ctx.plan) ?? undefined;
}

const at = (file: string): Pick<F, "at" | "atKind"> => ({ at: file, atKind: "instance" });

/** The mapping against the inventory: an org mapping against the org layer too (in a root's build, ctx.root). */
function mappingProblems(ctx: RuleContext): MappingProblem[] {
  const t = ctx.tracker;
  if (!t?.mapping || !t.inventory) return [];
  if (ctx.root && !isOrgMapping(t.mapping)) return [{ kind: "missing", message: "a shared root's tracker/mapping.yaml says kind: org: it measures the teams' standing work, and has no phase or unit sections (bun plumb.ts tracker draft-mapping <root> drafts one)" }];
  if (!isOrgMapping(t.mapping)) return validateMapping(t.mapping, t.inventory, ctx.model, ctx.plan);
  const org = ctx.root?.org;
  return validateOrgMapping(t.mapping, t.inventory, org ? {
    teams: org.teams.map((x) => ({ id: x.id, name: x.name })),
    activities: org.activities.map((a) => ({ id: a.id, name: a.name, team: a.team.replace(/^org:/, "") })),
  } : {});
}
const isLinksFile = (p: string) => p.startsWith("links.yaml");
const isStatusNote = (p: string) => p.startsWith("status \"");

const wired: Rule = {
  id: "tracker-wired", title: "The tracker is wired: inventory, mapping and export are all there", severity: "warning",
  why: "Reconciliation needs all three: the inventory says what the tracker has, the mapping says how it holds the plan, and the export holds the live state. With one missing, the plan silently stops being compared.",
  check(ctx) {
    const t = ctx.tracker;
    if (!t) return [];
    const out: F[] = [];
    if (!t.inventory) out.push({ ...at("tracker/inventory.json"), message: "no inventory: run `bun plumb.ts tracker discover <instance> --from <export dir>`" });
    if (!t.mapping) out.push({ ...at("tracker/mapping.yaml"), message: "no mapping: run `bun plumb.ts tracker draft-mapping <instance>` and edit the result" });
    if (t.inventory && !t.issues) out.push({ ...at("tracker export"), message: "the raw export the inventory names is not readable, so there is no live state to compare" });
    return out;
  },
};

const filesLoad: Rule = {
  id: "tracker-files-load", title: "Every tracker file reads", severity: "error",
  why: "A mapping, links file or export that does not read is skipped; the build says so instead of comparing against nothing.",
  check: (ctx) => (ctx.tracker?.problems ?? []).map((p) => ({ ...at(p.file), message: `${p.file}: ${p.message}` })),
};

const mappingMatches: Rule = {
  id: "mapping-matches-inventory", title: "The mapping names only what the tracker has", severity: "error",
  why: "Every organization arranges its tracker differently. A mapping that names an issue type, field, link type, status, project or container the inventory does not have would match nothing, and every unit would look unlinked.",
  check: (ctx) => mappingProblems(ctx).filter((p) => p.kind === "missing").map((p) => ({ ...at("tracker/mapping.yaml"), message: p.message })),
};

const mappingCovers: Rule = {
  id: "mapping-covers", title: "The mapping covers every milestone, team and status in use", severity: "warning",
  why: "A milestone with no container, a team with no tracker value or a status the mapping leaves out falls back to a guess, and the reconciliation is only as good as that guess.",
  check: (ctx) => mappingProblems(ctx).filter((p) => p.kind === "coverage").map((p) => ({ ...at("tracker/mapping.yaml"), message: p.message })),
};

const linksResolve: Rule = {
  id: "links-resolve", title: "Every confirmed link names a unit and an issue that exist", severity: "error",
  why: "The confirmed links are the reviewed record of which issue is which unit. A link naming a unit or issue that does not exist, or one issue twice, is a wiring mistake that would otherwise hide.",
  how: "Links are confirmed in tracker/links.yaml.",
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.problems ?? []).filter(isLinksFile).map((p) => ({ ...at("tracker/links.yaml"), message: p }));
  },
};

const labelsResolve: Rule = {
  id: "labels-name-units", title: "Every unit label in the tracker names a unit", severity: "warning",
  why: "A unit label on an issue (the label prefix and a unit's id) links that issue without review, so a typo silently links nothing; the issue then shows up unmatched or as a likely match instead.",
  how: how(SETTLE.label),
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.problems ?? []).filter((p) => !isLinksFile(p) && !isStatusNote(p)).map((p) => ({ ...at("tracker export"), message: p }));
  },
};

const unitHasIssue: Rule = {
  id: "unit-has-issue", title: "Every unit has an issue", severity: "warning",
  why: "A unit with no issue is planned work nobody can see on the board. Export it for import, or link the issue that already holds it.",
  how: "bun plumb.ts tracker export writes the import file; a confirmed link goes in tracker/links.yaml.",
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.unitsWithoutIssue ?? []).map((u) => ({ at: u, atKind: "unit" as const, message: `${u} has no issue in the tracker` }));
  },
};

const matchConfirmed: Rule = {
  id: "match-confirmed", title: "Likely matches are confirmed or rejected", severity: "warning",
  why: "A match by similar title is a guess. Until a person confirms it, the unit's tracker state is not shown and its dependencies are not compared.",
  how: "A person confirms a match in tracker/links.yaml (unit, issue, confirmed_by, confirmed_at).",
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.proposed ?? []).map((p) => ({ at: p.unit, atKind: "unit" as const, message: `${p.unit} likely matches ${p.issue} (${p.reasons.join(", ")}): confirm it in tracker/links.yaml` }));
  },
};

const issueHasUnit: Rule = {
  id: "issue-has-unit", title: "Every issue in a milestone's container has a unit", severity: "warning",
  why: "Work in the tracker that the plan does not know about either belongs in the plan as a unit or belongs somewhere else; either way the plan's picture of the milestone is incomplete.",
  how: how(SETTLE["no-unit"]),
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.issuesWithoutUnit ?? []).map((i) => ({ at: i.phase ?? "", atKind: "phase" as const, message: `${i.issue} "${i.summary}" (${i.type}) is in milestone ${i.phase}'s container but matches no unit` }));
  },
};

const statusAgrees: Rule = {
  id: "status-agrees", title: "A unit's status agrees with its issue", severity: "warning",
  why: "The tracker owns live state and the model keeps its own status; the engine never overwrites one with the other, so a disagreement is shown until a person settles it on one side.",
  how: how(SETTLE.status),
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.statusDisagreements ?? []).map((d) => ({ at: d.unit, atKind: "unit" as const, message: `${d.unit} is ${d.unitStatus} in the plan, but ${d.issue} is "${d.trackerStatus}" (${d.mapped}) in the tracker` }));
  },
};

const phaseAgrees: Rule = {
  id: "phase-agrees", title: "A unit's issue sits in its milestone's container", severity: "warning",
  why: "An issue filed under another milestone's epic (or version, or label) will be counted, planned and reported with the wrong milestone.",
  how: how(SETTLE.phase),
  check(ctx) {
    const r = reconcileFor(ctx);
    return (r?.phaseDisagreements ?? []).map((d) => ({ at: d.unit, atKind: "unit" as const, message: `${d.unit} is in milestone ${d.unitPhase}, but ${d.issue} sits ${d.issuePhase ? `in milestone ${d.issuePhase}'s container` : "outside every mapped milestone container"}` }));
  },
};

const depsBothSides: Rule = {
  id: "dependency-both-sides", title: "A dependency is on both sides or neither", severity: "warning",
  why: "The plan's dependencies come from capabilities; the tracker's from links people draw. One-sided, the board shows work as startable that is waiting, or waiting that is free.",
  how: how(SETTLE["deps-plan"], SETTLE["deps-tracker"]),
  check(ctx) {
    const r = reconcileFor(ctx);
    const link = ctx.tracker?.mapping?.dependency?.link_type ?? "dependency";
    return (r?.dependencyOneSided ?? []).map((d) => ({
      at: d.unit, atKind: "unit" as const,
      message: d.side === "model"
        ? `${d.unit} depends on ${d.dependsOn} in the plan, but ${d.issue} has no "${link}" link to ${d.dependsOnIssue}`
        : `${d.issue} has a "${link}" link to ${d.dependsOnIssue}, but ${d.unit} does not depend on ${d.dependsOn} in the plan`,
    }));
  },
};

const ownerAgrees: Rule = {
  id: "owner-agrees", title: "The tracker assigns each linked unit to the team that owns it", severity: "warning",
  why: "A unit's owner team comes from the parts it changes. Where the mapping reads a team from the tracker, the team the tracker assigns the unit's issue should be one of those. Typing a name into the model cannot settle a disagreement here; one side has to change, and a person decides which.",
  how: how(SETTLE.owner),
  check(ctx) {
    const r = reconcileFor(ctx);
    if (!r?.ownerDisagreements) return [];
    const name = (id: string) => ctx.team.get(id)?.name ?? id;
    return r.ownerDisagreements.map((d) => ({ at: d.unit, atKind: "unit" as const, message: `${d.unit} is owned by ${d.owners.map(name).join(" and ")} in the model, but ${d.issue} is assigned to ${name(d.trackerTeam)} in the tracker` }));
  },
};

export const pack: RulePack = {
  name: "tracker",
  title: "Tracker",
  description: "The plan against the organization's tracker: the mapping names only what the tracker has, every unit has an issue and every issue a unit, and status, milestone and dependencies agree. Findings only; the tracker never overwrites the plan.",
  rules: [wired, filesLoad, mappingMatches, mappingCovers, linksResolve, labelsResolve, unitHasIssue, matchConfirmed, issueHasUnit, statusAgrees, phaseAgrees, depsBothSides, ownerAgrees],
};
