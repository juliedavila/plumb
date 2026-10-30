// Export the plan's structure as a Jira CSV bulk-import file (Jira's "Import issues from CSV"), following the
// mapping, for units that are not linked to an issue yet. Units with a proposed match are held back until a
// person confirms or rejects the match, so the import does not create duplicates.
//
// Columns: Issue Id (a number local to the file, which the importer uses to resolve Parent and links inside it),
// Issue Type, Summary, Description, the done-condition field, Parent, Labels (repeated), the owner-team column
// (Component/s repeated, or the team field by name), Fix Version/s, and one issue-link column per dependency
// in the mapping's direction, named as Jira's own CSV export names them ("Outward issue link (Depends on)").
// Every exported unit carries its de-unit label, so after the import the next reconcile links it exactly.

import type { ExportFile } from "../adapter.ts";
import type { Model, Plan, TrackerInventory, TrackerMapping, TrackerReconcile, Unit } from "../../types.ts";
import { unitRoles } from "../../core/teams.ts";
import { analyzePlan, uniqueUnits } from "../../core/plan.ts";
import { natCompare } from "../../core/util.ts";

export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportJiraCsv(plan: Plan, m: TrackerMapping, inv: TrackerInventory, rec: TrackerReconcile, model?: Model): ExportFile {
  const c = { plan };
  const roles = model ? unitRoles(model, plan) : Object.fromEntries(plan.units.map((u) => [u.id, { owners: u.owner ? [u.owner] : [] }]));
  const units = uniqueUnits(c.plan).sort((a, b) => natCompare(a.id, b.id));
  const linked = new Map(rec.linked.map((l) => [l.unit, l.issue]));
  const held = new Set(rec.proposed.map((p) => p.unit));
  const todo = units.filter((u) => !linked.has(u.id) && !held.has(u.id));
  const notes: string[] = [];
  if (held.size) notes.push(`held back until confirmed or rejected in links.yaml: ${[...held].sort(natCompare).join(", ")}`);
  if (linked.size) notes.push(`already linked, not exported: ${linked.size} units`);

  const phaseName = new Map(c.plan.phases.map((p) => [p.id, p.name]));
  const fieldName = (id: string) => inv.fields.find((f) => f.id === id)?.name ?? id;
  const deps = analyzePlan(c.plan).deps;

  let next = 1;
  const rowId = new Map<string, number>();
  const epicRows: Record<string, string>[] = [];
  const parentOf = (u: Unit): string => {
    const v = m.phase.match[u.phase];
    if (m.phase.as !== "epic" && m.phase.as !== "initiative") return "";
    if (v) return v;
    // the phase has no container yet: create one in this file
    const key = `phase:${u.phase}`;
    if (!rowId.has(key)) {
      rowId.set(key, next++);
      epicRows.push({ "Issue Id": String(rowId.get(key)), "Issue Type": m.phase.as === "epic" ? "Epic" : "Initiative", Summary: phaseName.get(u.phase) ?? u.phase, Description: "", Parent: "" });
      notes.push(`phase ${u.phase} has no ${m.phase.as}: one is created in this file; add its key to mapping.yaml after the import`);
    }
    return String(rowId.get(key));
  };
  for (const u of todo) rowId.set(u.id, next++);

  const linkCol = m.dependency ? `${m.dependency.direction === "outward" ? "Outward" : "Inward"} issue link (${m.dependency.link_type})` : "";
  const doneCol = m.done_condition && m.done_condition.field !== "description" ? fieldName(m.done_condition.field) : "";
  const teamCol = m.owner_team?.as === "custom-field" && m.owner_team.field ? fieldName(m.owner_team.field) : m.owner_team?.as === "component" ? "Component/s" : m.owner_team?.as === "project" ? "Project Key" : "";

  const rows: { base: Record<string, string>; labels: string[]; links: string[]; team: string[] }[] = [];
  for (const u of todo) {
    const labels = [`${m.unit_label_prefix}${u.id}`];
    if (m.phase.as === "label" && m.phase.match[u.phase]) labels.push(m.phase.match[u.phase]);
    const owner = roles[u.id]?.owners[0]; // the unit's owner team, inherited from its parts unless it overrides them
    const team = owner && m.owner_team?.match[owner] ? [m.owner_team.match[owner]] : [];
    if (owner && m.owner_team && !team.length) notes.push(`${u.id}: team ${owner} has no value in owner_team.match, so the team column is empty`);
    const links: string[] = [];
    for (const d of deps[u.id] ?? []) {
      if (rowId.has(d)) links.push(String(rowId.get(d)));
      else if (linked.has(d)) notes.push(`${u.id} depends on ${d}, already ${linked.get(d)}: link it by hand after the import (the CSV importer links only issues in the file)`);
      else if (held.has(d)) notes.push(`${u.id} depends on ${d}, whose match is not confirmed yet: link it after confirming`);
    }
    const desc = [`Plumb unit ${u.id}, phase ${phaseName.get(u.phase) ?? u.phase}.`, u.requires?.length ? `Requires: ${u.requires.join(", ")}.` : "", u.provides?.length ? `Provides: ${u.provides.join(", ")}.` : ""].filter(Boolean);
    if (!doneCol) desc.push(`Done when: ${u.check}`);
    const base: Record<string, string> = {
      "Issue Id": String(rowId.get(u.id)), "Issue Type": m.unit.issue_type, Summary: u.title, Description: desc.join("\n"),
      ...(doneCol ? { [doneCol]: u.check } : {}),
      Parent: parentOf(u),
      ...(m.phase.as === "fix-version" ? { "Fix Version/s": m.phase.match[u.phase] ?? "" } : {}),
    };
    rows.push({ base, labels, links, team });
  }

  const nL = Math.max(1, ...rows.map((r) => r.labels.length)), nK = Math.max(1, ...rows.map((r) => r.links.length)), nT = Math.max(1, ...rows.map((r) => r.team.length));
  const baseCols = ["Issue Id", "Issue Type", "Summary", "Description", ...(doneCol ? [doneCol] : []), "Parent", ...(m.phase.as === "fix-version" ? ["Fix Version/s"] : [])];
  const header = [...baseCols, ...Array(nL).fill("Labels"), ...(teamCol ? Array(teamCol === "Component/s" ? nT : 1).fill(teamCol) : []), ...(linkCol ? Array(nK).fill(linkCol) : [])];
  const lines = [header.map(csvCell).join(",")];
  const pad = (xs: string[], n: number) => [...xs, ...Array(Math.max(0, n - xs.length)).fill("")];
  for (const e of epicRows) lines.push([...baseCols.map((k) => e[k] ?? ""), ...pad([], nL), ...(teamCol ? pad([], teamCol === "Component/s" ? nT : 1) : []), ...(linkCol ? pad([], nK) : [])].map(csvCell).join(","));
  for (const r of rows) lines.push([...baseCols.map((k) => r.base[k] ?? ""), ...pad(r.labels, nL), ...(teamCol ? pad(r.team, teamCol === "Component/s" ? nT : 1) : []), ...(linkCol ? pad(r.links, nK) : [])].map(csvCell).join(","));
  notes.unshift(`${rows.length} unit${rows.length === 1 ? "" : "s"} exported${epicRows.length ? `, plus ${epicRows.length} phase container${epicRows.length === 1 ? "" : "s"}` : ""}`);
  return { name: "jira-import.csv", content: lines.join("\r\n") + "\r\n", notes };
}
