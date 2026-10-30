// Draft a mapping.yaml from a Jira inventory and the instance: each engine concept gets the choice the
// inventory supports best, with a comment saying why and what else was possible. A person edits the result.

import type { Model, Plan, TrackerInventory } from "../../types.ts";
import { natCompare } from "../../core/util.ts";
import { bestMatch } from "../text.ts";

const y = (s: string) => JSON.stringify(s);
const key = (s: string) => (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) ? s : JSON.stringify(s));

/** Match each of `names` (id -> display name) to a distinct candidate, best scores first. */
function assign(names: [string, string][], candidates: string[], min: number): Map<string, { value: string; score: number }> {
  const all: { id: string; value: string; score: number }[] = [];
  for (const [id, name] of names) for (const c of candidates) {
    const m = bestMatch(name, [c], min);
    if (m) all.push({ id, value: c, score: m.score });
  }
  all.sort((a, b) => b.score - a.score || natCompare(a.id, b.id));
  const out = new Map<string, { value: string; score: number }>(), used = new Set<string>();
  for (const a of all) if (!out.has(a.id) && !used.has(a.value)) { out.set(a.id, a); used.add(a.value); }
  return out;
}

export function draftJiraMapping(inv: TrackerInventory, model: Model, plan: Plan): string {
  const L: string[] = [];
  const phases = [...plan.phases].sort((a, b) => a.order - b.order);
  L.push(
    "# How this organization's Jira holds Plumb's concepts. Drafted by `bun plumb.ts tracker draft-mapping`",
    "# from tracker/inventory.json; every choice below is a proposal with the reason for it. Edit it until it is right:",
    "# the tracker rule pack checks that everything named here exists in the inventory.",
    "#",
    "# The model owns structure (units, phases, dependencies); Jira owns live state (status, assignee, sprint).",
    "",
    "adapter: jira",
  );

  // project
  const projects = [...inv.projects].sort((a, b) => b.issues - a.issues || natCompare(a.key, b.key));
  const project = projects[0]?.key;
  L.push("", `# Projects in the export: ${projects.map((p) => `${p.key} (${p.name}, ${p.issues} issues${p.style ? `, ${p.style}` : ""})`).join("; ") || "none"}.`,
    `# ${project ? `${project} holds the most issues, so units live there.` : "No project found: set one."}`,
    `project: ${project ? y(project) : '""'}`);

  // exact-match label
  L.push("", "# An issue carrying this label plus a unit id (for example de-unit:U-05) is that unit's issue, no confirmation needed.",
    'unit_label_prefix: "de-unit:"');
  const prefixed = inv.labels.filter((l) => l.name.startsWith("de-unit:"));
  if (prefixed.length) L.push(`# ${prefixed.length} label${prefixed.length === 1 ? "" : "s"} with this prefix ${prefixed.length === 1 ? "is" : "are"} already in use.`);

  // phase
  const inProject = (k: string) => !project || k.startsWith(project + "-");
  const epics = inv.containers.filter((c) => c.level === 1 && inProject(c.key));
  const inits = inv.containers.filter((c) => c.level >= 2 && inProject(c.key));
  const phaseNames: [string, string][] = phases.map((p) => [p.id, p.name]);
  const byEpic = assign(phaseNames, epics.map((e) => e.summary), 0.3);
  const byInit = assign(phaseNames, inits.map((e) => e.summary), 0.3);
  const byVer = assign(phaseNames, inv.fixVersions.map((v) => v.name), 0.3);
  L.push("", "# phase -> epic | initiative | fix-version | label. `match` maps each phase id to an issue key (epic, initiative),",
    "# a fix version name, or a label.");
  let as: string, match: Map<string, string>, why: string;
  if (byEpic.size && byEpic.size >= byInit.size && byEpic.size >= byVer.size) {
    as = "epic"; why = `${byEpic.size} of ${phases.length} phases have an epic with a similar summary`;
    match = new Map([...byEpic].map(([id, m]) => [id, epics.find((e) => e.summary === m.value)!.key]));
  } else if (byInit.size && byInit.size >= byVer.size) {
    as = "initiative"; why = `${byInit.size} of ${phases.length} phases have an initiative with a similar summary`;
    match = new Map([...byInit].map(([id, m]) => [id, inits.find((e) => e.summary === m.value)!.key]));
  } else if (byVer.size) {
    as = "fix-version"; why = `${byVer.size} of ${phases.length} phases have a fix version with a similar name`;
    match = new Map([...byVer].map(([id, m]) => [id, m.value]));
  } else {
    as = "label"; why = "no epic, initiative or fix version resembles a phase, so phases become labels to add";
    match = new Map(phases.map((p) => [p.id, `de-phase:${p.id}`]));
  }
  L.push(`# Chose ${as}: ${why}.`);
  if (inits.length && as === "epic") L.push(`# Above the epics sits ${inits.map((i) => `${i.key} "${i.summary}" (${i.type})`).join(", ")}; it holds the whole plan, so it is not a phase.`);
  L.push("phase:", `  as: ${as}`, "  match:");
  for (const p of phases) {
    const v = match.get(p.id);
    const note = as === "epic" || as === "initiative" ? [...epics, ...inits].find((e) => e.key === v)?.summary : undefined;
    if (v) L.push(`    ${key(p.id)}: ${y(v)}${note ? `   # "${note}" for "${p.name}"` : ""}`);
    else L.push(`    # ${key(p.id)}: ""   # nothing resembles "${p.name}": name its ${as} here`);
  }

  // unit issue type
  const std = inv.issueTypes.filter((t) => t.level === 0 && !t.subtask && (!t.project || t.project === project) && t.count).sort((a, b) => b.count - a.count || natCompare(a.name, b.name));
  const ut = std[0]?.name ?? "Story";
  L.push("", `# unit -> an issue type in the project. Standard-level types in use: ${std.map((t) => `${t.name} (${t.count})`).join(", ") || "none"}.`,
    `# ${ut} is the most used; exported units become ${ut} issues. Existing issues of any standard type can still match.`,
    "unit:", `  issue_type: ${y(ut)}`, ...(project ? [`  project: ${y(project)}`] : []));

  // dependency
  const lts = inv.linkTypes;
  const dep = lts.find((l) => /depend|require|needs/i.test(`${l.name} ${l.outward} ${l.inward}`));
  const blocks = lts.find((l) => /^blocks$/i.test(l.name) || /\bblocks\b/i.test(l.outward));
  L.push("", "# dependency -> a link type and the side of the dependent issue: outward when the dependent issue's link reads",
    "# like \"depends on\", inward when it reads like \"is blocked by\".",
    `# Link types: ${lts.map((l) => `${l.name} (${l.outward} / ${l.inward}, ${l.count} links)`).join("; ") || "none"}.`);
  if (dep) {
    const dir = /depend|require|needs/i.test(dep.outward) ? "outward" : "inward";
    L.push(`# Chose ${dep.name}: a dependency link type of its own${blocks ? `, kept apart from ${blocks.name}, which teams also use for other reasons` : ""}.`,
      "dependency:", `  link_type: ${y(dep.name)}`, `  direction: ${dir}   # the dependent issue ${dir === "outward" ? dep.outward : dep.inward} the issue it waits on`);
  } else if (blocks) {
    L.push(`# Chose ${blocks.name}: no dependency link type exists; the blocked issue is the dependent one.`,
      "dependency:", `  link_type: ${y(blocks.name)}`, `  direction: inward   # the dependent issue ${blocks.inward} the issue it waits on`);
  } else L.push("# No link type fits; dependencies are not compared until one is named.", "# dependency:", '#   link_type: ""', "#   direction: outward");

  // owner team
  const teamNames: [string, string][] = model.teams.map((t) => [t.id, t.name]);
  const opts: { as: string; field?: string; label: string; values: string[] }[] = [];
  for (const f of inv.fields.filter((f) => f.role === "team" && f.values?.length)) opts.push({ as: "custom-field", field: f.id, label: `the ${f.name} field (${f.id})`, values: f.values!.map((v) => v.name) });
  if (inv.components.length) opts.push({ as: "component", label: "components", values: inv.components.map((c) => c.name) });
  if (inv.projects.length > 1) opts.push({ as: "project", label: "projects", values: inv.projects.map((p) => p.key) });
  const scored = opts.map((o) => ({ o, m: assign(teamNames, o.values, 0.5) })).sort((a, b) => b.m.size - a.m.size);
  L.push("", "# owner team -> component | custom-field | project. `match` maps each model team id to the value Jira holds.");
  if (scored.length) {
    L.push(`# Candidates: ${scored.map((s) => `${s.o.label}, ${s.m.size} of ${model.teams.length} teams matched`).join("; ")}.`);
    const best = scored[0];
    L.push(`# Chose ${best.o.label}.`, "owner_team:", `  as: ${best.o.as}`, ...(best.o.field ? [`  field: ${y(best.o.field)}`] : []), "  match:");
    for (const t of model.teams) {
      const mm = best.m.get(t.id);
      if (mm) L.push(`    ${key(t.id)}: ${y(mm.value)}${mm.score < 1 ? `   # looks like "${t.name}"` : ""}`);
      else L.push(`    # ${key(t.id)}: ""   # no value looks like "${t.name}"; values: ${best.o.values.join(", ")}`);
    }
  } else L.push("# No team field, component or second project to read a team from.", "# owner_team:", "#   as: component", "#   match: {}");

  // done condition
  const acc = inv.fields.filter((f) => f.role === "acceptance").sort((a, b) => b.count - a.count)[0];
  L.push("", "# done-condition -> the field that holds a unit's check (its acceptance criteria) on export.",
    acc ? `# ${acc.name} (${acc.id}) is on ${acc.count} issues.` : "# No acceptance-criteria field, so the check goes into the description.",
    "done_condition:", `  field: ${y(acc?.id ?? "description")}`);

  // status
  const cats = new Map<string, { cat: string; names: string[] }>();
  for (const s of inv.statuses) {
    const c = cats.get(s.categoryName) ?? { cat: s.category, names: [] };
    c.names.push(`${s.name} (${s.count})`); cats.set(s.categoryName, c);
  }
  const odd = inv.statuses.filter((s) => s.category === "done" && s.count && !/^(done|closed|resolved|won'?t do)$/i.test(s.name));
  L.push("", "# status -> by category or by name, to todo | doing | done. Statuses in use, by category:");
  for (const [name, c] of cats) L.push(`#   ${name}: ${c.names.join(", ")}`);
  if (odd.length) L.push(`# Check: ${odd.map((s) => `"${s.name}"`).join(", ")} ${odd.length === 1 ? "is" : "are"} in the Done category. If the team does not mean finished by ${odd.length === 1 ? "it" : "them"}, switch to by: name and list every status.`);
  L.push("status:", "  by: category", "  map:");
  for (const [name, c] of cats) L.push(`    ${key(name)}: ${c.cat}`);
  return L.join("\n") + "\n";
}
