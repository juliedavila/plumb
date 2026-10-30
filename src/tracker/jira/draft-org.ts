// Draft an org mapping (tracker/mapping.yaml, kind: org) for a shared root from a Jira inventory and the root's org
// layer: the field that holds each issue's team, the status map, the window, the design-work
// label prefix, an activity rule for each org activity that something in the export resembles (labels, components,
// issue types, option field values and epics, each with its count), and a flow item for each issue type in use. Every
// choice is a proposal with the reason for it; a person edits the result.

import type { TrackerInventory } from "../../types.ts";
import { natCompare } from "../../core/util.ts";
import { bestMatch } from "../text.ts";
import { DEFAULT_LABEL_PREFIX, DEFAULT_WINDOW_DAYS } from "../mapping.ts";

const y = (s: string) => JSON.stringify(s);
const key = (s: string) => (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) ? s : JSON.stringify(s));

/** The org layer's teams and activities, bare ids, in org.yaml order. */
export interface OrgDraftInput { teams: { id: string; name: string }[]; activities: { id: string; name: string; team: string }[] }

/** Match each of `names` (id -> display name) to a distinct candidate, best scores first. */
function assign(names: [string, string][], candidates: string[], min: number): Map<string, { value: string; score: number }> {
  const all: { id: string; value: string; score: number }[] = [];
  for (const [id, name] of names) for (const c of candidates) { const m = bestMatch(name, [c], min); if (m) all.push({ id, value: c, score: m.score }); }
  all.sort((a, b) => b.score - a.score || natCompare(a.id, b.id));
  const out = new Map<string, { value: string; score: number }>(), used = new Set<string>();
  for (const a of all) if (!out.has(a.id) && !used.has(a.value)) { out.set(a.id, a); used.add(a.value); }
  return out;
}

/** A guess at an issue type's flow item, from its name. */
export function guessFlowItem(type: string): { item: string; sure: boolean } {
  const t = type.toLowerCase();
  if (/bug|defect|incident|problem|outage/.test(t)) return { item: "defect", sure: true };
  if (/debt|chore|refactor|maintenance|upkeep|clean/.test(t)) return { item: "debt", sure: true };
  if (/vuln|security|risk|pen ?test|audit|compliance|finding/.test(t)) return { item: "risk", sure: true };
  if (/story|feature|epic|improvement|request|initiative/.test(t)) return { item: "feature", sure: true };
  return { item: "risk", sure: false };
}

interface Candidate { kind: "labels" | "components" | "type" | "field" | "parent"; value: string; field?: string; fieldName?: string; count: number; label: string }

export function draftJiraOrgMapping(inv: TrackerInventory, org: OrgDraftInput): string {
  const L: string[] = [];
  L.push(
    "# How this organization's Jira holds its teams' standing work: the shared root's org mapping (kind: org), read by",
    "# `bun plumb.ts tracker measure <root>`. Drafted by `bun plumb.ts tracker draft-mapping` from tracker/inventory.json and",
    "# the org layer; every choice below is a proposal with the reason for it. Edit it until it is right: `bun plumb.ts check",
    "# <root>` checks that everything named here is in the inventory.",
    "",
    "adapter: jira",
    "kind: org",
  );

  // team
  const teamNames: [string, string][] = org.teams.map((t) => [t.id, t.name]);
  const opts: { as: string; field?: string; label: string; values: string[] }[] = [];
  for (const f of inv.fields.filter((f) => f.values?.length)) opts.push({ as: "custom-field", field: f.id, label: `the ${f.name} field (${f.id})`, values: f.values!.map((v) => v.name) });
  if (inv.components.length) opts.push({ as: "component", label: "components", values: inv.components.map((c) => c.name) });
  if (inv.projects.length > 1) opts.push({ as: "project", label: "projects", values: inv.projects.map((p) => p.key) });
  const scored = opts.map((o) => ({ o, m: assign(teamNames, o.values, 0.5) })).sort((a, b) => b.m.size - a.m.size || (a.o.as === "custom-field" ? -1 : 0));
  L.push("", "# team -> custom-field | component | project: how an issue names its team. `match` maps each org team id to the value", "# the tracker holds. An issue with no team value is left out of every share, and counted.");
  if (scored.length && scored[0].m.size) {
    L.push(`# Candidates: ${scored.map((s) => `${s.o.label}, ${s.m.size} of ${org.teams.length} teams matched`).join("; ")}.`);
    const best = scored[0];
    L.push(`# Chose ${best.o.label}.`, "team:", `  as: ${best.o.as}`, ...(best.o.field ? [`  field: ${y(best.o.field)}`] : []), "  match:");
    for (const t of org.teams) {
      const mm = best.m.get(t.id);
      if (mm) L.push(`    ${key(t.id)}: ${y(mm.value)}${mm.score < 1 ? `   # looks like "${t.name}"` : ""}`);
      else L.push(`    # ${key(t.id)}: ""   # no value looks like "${t.name}"; values: ${best.o.values.join(", ")}`);
    }
  } else L.push("# No field, component or project resembles the org layer's teams: name the field that holds the team.", "team:", "  as: custom-field", '  field: ""', "  match: {}");

  // status
  L.push("", "# status -> by name, to todo | doing | done. A team's time in statuses mapped to doing is what the shares divide.",
    `# Statuses in use: ${inv.statuses.map((s) => `${s.name} (${s.categoryName}, ${s.count})`).join(", ") || "none"}.`,
    "status:", "  by: name", "  map:");
  for (const s of inv.statuses) L.push(`    ${key(s.name)}: ${s.category}`);

  L.push("", `window_days: ${DEFAULT_WINDOW_DAYS}   # the measure covers the days ending at the export's date`);

  const prefix = DEFAULT_LABEL_PREFIX;
  const designLabels = inv.labels.filter((l) => l.name.startsWith(prefix));
  const namespaced = designLabels.filter((l) => /^[a-z][a-z0-9-]{0,23}:./.test(l.name.slice(prefix.length)));
  L.push("", `# design work: an issue labelled ${prefix}<namespace>:<unit> (for example ${prefix}intake:U-04) is design work, never`,
    `# standing work. A bare ${prefix}<unit> is a lone instance's label and does not count as design work here.`,
    designLabels.length ? `# ${designLabels.length} label${designLabels.length === 1 ? "" : "s"} with the prefix ${designLabels.length === 1 ? "is" : "are"} in use, ${namespaced.length} of them namespaced.` : "# No label with the prefix is in use yet.",
    "designs:", `  label_prefix: ${y(prefix)}`);

  // activities
  const cands: Candidate[] = [
    ...inv.labels.filter((l) => !l.name.startsWith(prefix)).map((l) => ({ kind: "labels" as const, value: l.name, count: l.count, label: `label ${l.name}` })),
    ...inv.components.map((c) => ({ kind: "components" as const, value: c.name, count: c.count, label: `component ${c.name}` })),
    ...inv.issueTypes.filter((t) => t.level === 0 && !t.subtask && t.count).map((t) => ({ kind: "type" as const, value: t.name, count: t.count, label: `issue type ${t.name}` })),
    ...inv.fields.filter((f) => f.role !== "team" && f.values?.length).flatMap((f) => f.values!.map((v) => ({ kind: "field" as const, value: v.name, field: f.id, fieldName: f.name, count: v.count, label: `${f.name} ${v.name}` }))),
    ...inv.containers.filter((c) => c.level === 1).map((c) => ({ kind: "parent" as const, value: c.key, count: c.children, label: `epic ${c.key} "${c.summary}"` })),
  ];
  const nameOf = (c: Candidate) => (c.kind === "parent" ? inv.containers.find((x) => x.key === c.value)?.summary ?? c.value : c.value);
  L.push("", "# activities -> one rule per activity of the org layer: the first rule, top to bottom, that an issue of the activity's own",
    "# team matches wins. A rule matches on project, type, labels, components, parent (an epic key) or field: { <field id>: <value> };",
    "# every key it gives must hold. What the export holds, with counts:");
  const top = (kind: Candidate["kind"], n = 8) => cands.filter((c) => c.kind === kind).sort((a, b) => b.count - a.count || natCompare(a.value, b.value)).slice(0, n).map((c) => `${c.kind === "field" ? `${c.fieldName}: ` : ""}${c.kind === "parent" ? c.value : c.value} (${c.count})`).join(", ");
  for (const [k, label] of [["labels", "labels"], ["components", "components"], ["type", "issue types"], ["field", "field values"], ["parent", "epics"]] as const) { const s = top(k); if (s) L.push(`#   ${label}: ${s}`); }
  L.push("activities:");
  for (const a of org.activities) {
    let best: { c: Candidate; score: number } | undefined;
    for (const c of cands) for (const n of [a.name, a.id.replace(/[-_]/g, " "), a.id]) {
      const m = bestMatch(n, [nameOf(c)], 0.3) ?? (c.value.toLowerCase() === a.id.toLowerCase() ? { value: c.value, score: 1 } : undefined);
      if (m && (!best || m.score > best.score || (m.score === best.score && c.count > best.c.count))) best = { c, score: m.score };
    }
    if (best) {
      const c = best.c;
      const match = c.kind === "field" ? `{ field: { ${c.field}: ${y(c.value)} } }` : c.kind === "parent" ? `{ parent: ${c.value} }` : `{ ${c.kind}: [${y(c.value)}] }`;
      L.push(`  - { activity: ${key(a.id)}, match: ${match} }   # "${a.name}" looks like the ${c.label} (${c.count} issue${c.count === 1 ? "" : "s"})`);
    } else L.push(`  # - { activity: ${key(a.id)}, match: { labels: [""] } }   # nothing in the export looks like "${a.name}": name what its issues hold`);
  }

  // flow items
  const types = inv.issueTypes.filter((t) => t.count && !t.subtask).sort((a, b) => b.count - a.count || natCompare(a.name, b.name));
  L.push("", "# flow_items -> each issue type's flow item (feature, defect, risk or debt), for the distribution view.", "flow_items:");
  for (const t of types) { const g = guessFlowItem(t.name); L.push(`  ${key(t.name)}: ${g.item}${g.sure ? "" : "   # a guess: this type could be any of the four"}`); }
  return L.join("\n") + "\n";
}
