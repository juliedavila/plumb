// Markdown renderings of findings, plan analysis and impact, for the CLI (and any other text consumer).

import type { Bundle, Finding, Impact, Plan, PlanAnalysis } from "../types.ts";
import { providersOf } from "./plan.ts";

/** Why nobody can unblock a capability: nothing provides it, only the unit itself does, or which units do. */
export function waitingText(plan: Plan, unitId: string, missing: string[], waitingOn: string[]): string {
  if (waitingOn.length) return waitingOn.map((w) => `\`${w}\``).join(", ");
  const prov = providersOf(plan);
  const parts = missing.map((c) => {
    const ps = prov.get(c) ?? [];
    if (!ps.length) return `no unit provides \`${c}\``;
    if (ps.every((x) => x === unitId)) return `only this unit provides \`${c}\`, so it can never start`;
    return `\`${c}\` waits on ${ps.filter((x) => x !== unitId).map((x) => `\`${x}\``).join(", ")}`;
  });
  return parts.join("; ");
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function findingsMd(findings: Finding[], title = "Checks"): string {
  const errors = findings.filter((f) => f.severity === "error"), warnings = findings.filter((f) => f.severity === "warning");
  const out = [`# ${title}`, "", `${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`, ""];
  for (const [label, fs] of [["Errors", errors], ["Warnings", warnings]] as const) {
    if (!fs.length) continue;
    out.push(`## ${label}`, "");
    let group = "";
    for (const f of fs) {
      const g = `${f.pack} / ${f.rule}`;
      if (g !== group) { if (group) out.push(""); out.push(`### ${g}`, ""); group = g; }
      out.push(`- \`${f.at}\` (${f.atKind}): ${f.message}`);
    }
    out.push("");
  }
  if (!findings.length) out.push("All checks pass.", "");
  return out.join("\n");
}

export function planMd(plan: Plan, a: PlanAnalysis, title = "Plan"): string {
  const unit = new Map([...plan.units].reverse().map((u) => [u.id, u])); // first wins on duplicate ids
  const name = (id: string) => `\`${id}\` ${unit.get(id)?.title ?? ""}`.trim();
  const out = [`# ${title}`, ""];
  out.push("## Milestone progress", "", "| Milestone | Name | Done | Reached |", "|---|---|---|---|");
  const ph = new Map(plan.phases.map((p) => [p.id, p]));
  for (const p of a.phases) out.push(`| \`${p.id}\` | ${esc(ph.get(p.id)?.name ?? "")} | ${p.done}/${p.total} | ${p.complete ? "yes" : "no"} |`);
  out.push("", "## Can start now (frontier)", "");
  if (a.frontier.length) for (const id of a.frontier) out.push(`- ${name(id)}${unit.get(id)?.status === "doing" ? " (in progress)" : ""}`);
  else out.push("Nothing: every open unit is waiting on something.");
  out.push("", "## Critical path", "");
  if (a.critical_path.length) out.push(`${a.critical_path.length} unit${a.critical_path.length === 1 ? "" : "s"} long:`, "", ...a.critical_path.map((id, i) => `${i + 1}. ${name(id)}`));
  else out.push("Nothing left: every unit is done.");
  const blocked = Object.entries(a.blocked);
  if (blocked.length) {
    out.push("", "## Blocked", "", "| Unit | Missing capabilities | Waiting on |", "|---|---|---|");
    for (const [id, b] of blocked) out.push(`| ${esc(name(id))} | ${b.missing.map((c) => `\`${c}\``).join(", ")} | ${esc(waitingText(plan, id, b.missing, b.waitingOn))} |`);
  }
  if (a.unprovided.length) out.push("", "## Required but never provided", "", ...a.unprovided.map((c) => `- \`${c}\``));
  out.push("");
  return out.join("\n");
}

const VERDICT_WORDS = { fail: "it breaks a check", caution: "it passes every check and needs a person's review", pass: "it passes every check" } as const;

export function impactMd(imp: Impact, patchTitle?: string, why?: string): string {
  const out = [`# Impact of patch \`${imp.patch}\`${patchTitle ? `: ${patchTitle}` : ""}`, "", `Status: ${imp.status}.`];
  if (why) out.push("", `Why: ${why}`);
  const list = (h: string, xs: string[]) => { out.push("", `## ${h}`, ""); out.push(...(xs.length ? xs : ["None."])); };
  if (imp.verdict) {
    const v = imp.verdict;
    out.push("", `## Verdict: ${v.level} (${VERDICT_WORDS[v.level]})`, "", ...(v.reasons.length ? v.reasons.map((r) => `- ${r}`) : ["- Nothing needs flagging: it breaks no check, no finding leaves only with a removed record, and every unit and record its title or why names is done or changed by an operation."]), "", v.reject, "", v.revise);
  }
  if (imp.errors.length) list("Ops that could not apply", imp.errors.map((e) => `- ${e}`));
  list("Added", imp.added.map((x) => `- ${x.kind} \`${x.id}\``));
  list("Removed", imp.removed.map((x) => `- ${x.kind} \`${x.id}\``));
  list("Modified", imp.modified.map((x) => `- ${x.kind} \`${x.id}\`: ${x.fields.join(", ")}`));
  list("Cascade", imp.cascade.map((x) => `- ${x.kind} \`${x.id}\`: ${x.because}`));
  const f = (x: Finding) => `- [${x.severity}] ${x.pack} / ${x.rule} at \`${x.at}\`: ${x.message}`;
  list("Findings introduced", imp.findingsIntroduced.map(f));
  list("Findings resolved", imp.findingsResolved.map(f));
  list("Gone with the removed record", (imp.findingsGone ?? []).map(f));
  list("Units affected", imp.unitsAffected.map((u) => `- \`${u}\``));
  out.push("");
  return out.join("\n");
}

export function buildSummaryMd(b: Bundle, outDir: string, site: string): string {
  const e = b.findings.filter((f) => f.severity === "error").length, w = b.findings.length - e;
  return [
    `# Built ${b.instance.title}`, "",
    `- ${b.model.elements.length} elements, ${b.model.relationships.length} relationships, ${b.plan.units.length} units, ${b.patches.length} patches`,
    `- ${e} errors, ${w} warnings`,
    `- bundle: ${outDir}/bundle.json`,
    `- site: ${site}`,
    `- hash: ${b.engine.hash}`,
    ...(b.engine.modelHash ? [`- model: ${b.engine.modelHash.slice(0, 12)} (a new patch's provenance.based_on)`] : []), "",
  ].join("\n");
}

// ---------- premises ----------

const GRADE_WORD: Record<string, string> = { evidence: "backed by evidence", inference: "inferred from evidence", judgment: "a judgment call", untested: "untested" };

/** "If this is false": what rests on one claim, as Markdown. */
export function premiseMd(b: Bundle, claimId: string): string {
  const claims = b.model.claims ?? [];
  const c = claims.find((x) => x.id === claimId);
  if (!c) return `# No claim ${claimId}\n\nKnown claims: ${claims.map((x) => `\`${x.id}\``).join(", ") || "none"}.\n`;
  const im = b.premises?.[c.id];
  const name = (kind: string, id: string): string => {
    if (kind === "element") return b.model.elements.find((e) => e.id === id)?.name ?? id;
    if (kind === "unit") return b.plan.units.find((u) => u.id === id)?.title ?? id;
    if (kind === "phase") return b.plan.phases.find((p) => p.id === id)?.name ?? id;
    if (kind === "claim") return claims.find((x) => x.id === id)?.statement ?? id;
    if (kind === "relationship") { const r = b.model.relationships.find((x) => x.id === id); return r ? r.label ?? `${r.from} to ${r.to}` : id; }
    return id;
  };
  const out = [`# If ${c.id} is false`, "", `> ${c.statement}`, "", `${c.kind[0].toUpperCase() + c.kind.slice(1)}, ${GRADE_WORD[c.grade] ?? c.grade}.${c.source ? ` Source: ${c.source}` : ""}`];
  if (c.fallback) out.push("", `Fallback: ${c.fallback}`);
  if (c.rests_on?.length) out.push("", `It rests on ${c.rests_on.map((x) => `\`${x}\``).join(", ")}.`);
  const tested = (c.attrs?.tested_by as string[] | undefined) ?? [];
  if (tested.length) out.push("", `Tested by ${tested.map((x) => `\`${x}\``).join(", ")}.`);
  if (!im || !im.counts.total) { out.push("", "Nothing in the model or the plan rests on it.", ""); return out.join("\n"); }
  const k = im.counts;
  const bits = [k.elements && `${k.elements} part${k.elements === 1 ? "" : "s"}`, k.relationships && `${k.relationships} relationship${k.relationships === 1 ? "" : "s"}`, k.units && `${k.units} unit${k.units === 1 ? "" : "s"}`, k.phases && `${k.phases} milestone${k.phases === 1 ? "" : "s"}`, k.claims && `${k.claims} other claim${k.claims === 1 ? "" : "s"}`].filter(Boolean);
  const sliceN = im.units.reduce((n, g) => n + g.units.length, 0);
  if (im.atStake?.length) {
    const st = (p: string) => b.status?.milestones.find((m) => m.phase === p);
    out.push("", `Milestones whose own work rests on it: ${im.atStake.map((p) => `**${b.plan.phases.find((x) => x.id === p)?.name ?? p}** (${st(p)?.status ?? "no status"}${st(p)?.reasons.some((r) => r.criterion === "untested-premise" && r.refs.some((x) => x.id === c.id)) ? (st(p)?.computed === "red" ? ", red for other reasons" : ", amber partly because of this") : ""})`).join(", ")}.`);
  }
  const turned = (im.amberBy ?? []).filter((p) => !(im.atStake ?? []).includes(p));
  if (turned.length) out.push("", `Turned amber by it (their work changes a part that rests on it): ${turned.map((p) => `**${b.plan.phases.find((x) => x.id === p)?.name ?? p}**`).join(", ")}.`);
  out.push("", `${im.direct.length} record${im.direct.length === 1 ? "" : "s"} rest on it directly; ${k.total} in all (${bits.join(", ")}). The plan slice is ${sliceN} unit${sliceN === 1 ? "" : "s"}, ${im.openUnits} of them not done.`);
  out.push("", "## What rests on it", "", "| Record | Kind | Through |", "|---|---|---|");
  for (const d of im.dependents) out.push(`| \`${d.id}\` ${esc(name(d.kind, d.id))} | ${d.kind} | ${d.via.length > 1 ? d.via.slice(1).map((x) => `\`${x}\``).join(" → ") : "directly"} |`);
  if (im.units.length) {
    out.push("", "## The plan slice, by milestone", "");
    const ph = new Map(b.plan.phases.map((p) => [p.id, p]));
    for (const g of im.units) out.push(`- **${g.phase}${ph.get(g.phase) ? ` ${ph.get(g.phase)!.name}` : ""}** (${g.units.length}): ${g.units.map((u) => `\`${u}\``).join(", ")}`);
  }
  out.push("");
  return out.join("\n");
}
