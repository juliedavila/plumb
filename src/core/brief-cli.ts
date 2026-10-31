import { invocation } from "./invocation.ts";
// `bun plumb.ts brief <instance-dir>`: what changed and what needs a person, as Markdown, read-only.
//
// It builds the instance in memory (nothing is written, not even build/) and prints, in this order: the plan's status
// sentence and each milestone's status with its first reason; what changed since the deck's baseline report; what
// needs a person (open questions in notes.yaml, proposed patches with their verdicts, a 0.4 design's discovered
// current-state records, error findings, overrides and unit statuses that fail their checks, the tracker's
// disagreements); and the work that can start now, ranked by how much it unblocks. Ids stay in, because an agent acts
// on them. The skill's orient task runs this first.
import { resolve } from "node:path";
import { buildBundle } from "./bundle.ts";
import { sinceLine } from "./report-cli.ts";

const cut = (s: string, n = 140) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const cell = (s: string) => s.replace(/\|/g, "\\|");
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

export async function briefMd(dir: string): Promise<string> {
  const { bundle: b, warnings } = await buildBundle(resolve(dir));
  const L: string[] = [`# Brief: ${b.instance.title}`, "", `Built ${b.engine.built}. Model hash \`${(b.engine.modelHash ?? "").slice(0, 12)}\` (a new patch's provenance.based_on).`, ""];
  const phase = new Map(b.plan.phases.map((p) => [p.id, p]));
  const title = new Map(b.plan.units.map((u) => [u.id, u.title]));

  L.push("## Status", "");
  if (b.status) {
    L.push(b.status.overall.lead?.text ?? b.status.overall.text, "");
    L.push("| Milestone | Shown | Computed | First reason | Override |", "|---|---|---|---|---|");
    for (const m of b.status.milestones) {
      const r = m.reasons[0];
      L.push(`| ${cell(phase.get(m.phase)?.name ?? m.phase)} (\`${m.phase}\`)${m.current ? " (current)" : ""}${m.reached ? " (reached)" : ""} | ${m.status} | ${m.computed} | ${cell(r ? cut(r.short ?? r.text) : "none")} | ${m.override ? cell(`${m.override.status} by ${m.override.by} on ${m.override.date}${m.override.review_by ? `, review by ${m.override.review_by}` : ""}${m.flags?.length ? `. Check it: ${m.flags.map((x) => x.text.replace(/[.\s]+$/, "")).join("; ")}` : ""}`) : "none"} |`);
    }
  } else L.push("No status: this build computes none.");
  L.push("", "## Since the last report", "", sinceLine(b), "");

  L.push("## Needs a person", "");
  const open = (b.notes?.items ?? []).filter((n) => n.status === "open" && n.kind === "question");
  L.push(`### Open questions in notes.yaml (${open.length})`, "");
  for (const n of open) L.push(`- \`${n.id}\` on ${n.target.kind} \`${n.target.id}\`: ${cut(n.text)}`);
  if (!open.length) L.push("- none");
  const proposed = b.patches.filter((p) => p.status === "proposed");
  L.push("", `### Proposed patches (${proposed.length})`, "");
  for (const p of proposed) L.push(`- \`${p.id}\` ${cut(p.title, 90)}: verdict ${p.impact.verdict?.level ?? "unknown"}${p.impact.verdict?.reasons[0] ? `; ${cut(p.impact.verdict.reasons[0])}` : ""}`);
  if (!proposed.length) L.push("- none");
  // current state (0.4): records the investigation pod found that no person has confirmed yet (current.yaml)
  if (b.current) {
    const waiting = b.current.records.filter((c) => c.state === "discovered");
    L.push("", `### Discovered current-state records waiting for a person to confirm (${waiting.length} of ${b.current.counts.records})`, "");
    for (const c of waiting) L.push(`- \`${c.part}\` ${cut(c.name, 60)}${c.todayOnly ? " (exists only today)" : ""}: ${c.disposition ?? "no disposition"}${c.replaced_by ? ` by \`${c.replaced_by}\`` : ""}. ${cut(c.text)}`);
    if (!waiting.length) L.push("- none");
  }
  const errors = b.findings.filter((f) => f.severity === "error");
  L.push("", `### Error findings (${errors.length})`, "");
  for (const f of errors.slice(0, 15)) L.push(`- \`${f.pack}/${f.rule}@${f.at}\`: ${cut(f.text ?? f.message)}`);
  if (errors.length > 15) L.push(`- and ${errors.length - 15} more: run \`${invocation()} check ${dir}\``);
  if (!errors.length) L.push("- none");
  const t = b.tracker?.reconcile;
  L.push("", "### Tracker", "");
  if (!t) L.push("- no reconciliation (no tracker mapping or export for this instance)");
  else {
    const c = t.counts;
    L.push(`- ${n(c.statusDisagreements, "status disagreement")}, ${n(c.phaseDisagreements, "milestone disagreement")}, ${n(t.ownerDisagreements?.length ?? 0, "owner disagreement")}, ${n(c.dependencyOneSided, "dependency", "dependencies")} on one side only`);
    L.push(`- ${n(c.proposed, "likely match", "likely matches")} to confirm in tracker/links.yaml; ${n(c.unitsWithoutIssue, "unit")} with no issue; ${n(c.issuesWithoutUnit, "issue")} with no unit`);
    if (b.tracker?.latestUpdate) L.push(`- newest issue update in the export: ${b.tracker.latestUpdate}`);
  }
  if (warnings.length) { L.push("", `### Build warnings (${warnings.length})`, ""); for (const w of warnings.slice(0, 10)) L.push(`- ${cut(w)}`); }

  const rank = b.analysis.unblocksTransitive ?? {};
  // ready work and work already moving are counted apart: "who starts this" is not "who is on it"
  const statusOf = new Map(b.plan.units.map((u) => [u.id, u.status ?? "todo"]));
  const byRank = (xs: string[]) => [...xs].sort((x, y) => (rank[y] ?? 0) - (rank[x] ?? 0));
  const ready = byRank(b.analysis.frontier.filter((id) => statusOf.get(id) !== "doing")), moving = byRank(b.analysis.frontier.filter((id) => statusOf.get(id) === "doing"));
  const start = ready.slice(0, 8);
  L.push("", `## Can start now (${ready.length} ready${moving.length ? `, ${moving.length} already moving` : ""}; the first ${start.length} by how many open units each unblocks)`, "");
  for (const id of start) L.push(`- \`${id}\` ${cut(title.get(id) ?? id, 100)}: unblocks ${rank[id] ?? 0}`);
  if (!start.length) L.push("- none");
  if (moving.length) { L.push("", "Already moving:"); for (const id of moving.slice(0, 5)) L.push(`- \`${id}\` ${cut(title.get(id) ?? id, 100)}: unblocks ${rank[id] ?? 0}`); }
  L.push("");
  return L.join("\n");
}

export async function briefCli(dir: string): Promise<number> {
  console.log(await briefMd(dir));
  return 0;
}
