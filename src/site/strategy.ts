// The Strategy page (what the design is betting on), the Notes page and the compared-builds section, as static markup.
// The client (src/site/client/strategy.js) adds the claim detail ("if this is false"), the notes in place on every
// record, adding and answering notes under the dev server, and "Since you last looked".
import type { Bundle, BuildDiff, Claim, DiffRecord, Note } from "../types";
import { DIGEST } from "../core/digest.ts";
import { esc, natural } from "./html";
import { count, fmt, list, para, quote } from "./prose";
import { rankByStakes, weight } from "../core/premise";
import { claimShort } from "../core/reader";

export const GRADE: Record<string, { icon: string; word: string; cls: string; long: string }> = {
  evidence: { icon: "g-evidence", word: "Evidence", cls: "g-evidence", long: "backed by evidence" },
  inference: { icon: "g-inference", word: "Inference", cls: "g-inference", long: "inferred from evidence" },
  judgment: { icon: "g-judgment", word: "Judgment", cls: "g-judgment", long: "a judgment call" },
  untested: { icon: "g-untested", word: "Untested", cls: "g-untested", long: "untested" },
};
const KIND_WORD: Record<string, [string, string]> = { premise: ["premise", "premises"], claim: ["conclusion", "conclusions"], assumption: ["assumption", "assumptions"] };

/** Grade symbols for the page's sprite: a filled circle with a check, a half circle, a hollow square, a dashed circle. */
export const GRADE_SYMBOLS = `<symbol id="i-g-evidence" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" stroke="var(--bg-surface)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-g-inference" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-g-judgment" viewBox="0 0 16 16"><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-g-untested" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.6 2.1"/><path d="M6.4 6.3a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.6-.8 1.2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".9" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-note" viewBox="0 0 16 16"><path d="M3 2.5h10v8l-3 3H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 13.5v-3h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>
<symbol id="i-question" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.3-.8.6-.8 1.3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="8" cy="11.4" r=".95" fill="currentColor" stroke="none"/></symbol>`;

export function gradeStatus(grade: string, size = "sm"): string {
  const g = GRADE[grade] ?? { icon: "g-untested", word: grade, cls: "g-untested" };
  return `<span class="st ${g.cls}${size ? " " + size : ""}"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${g.icon}"/></svg><span class="w">${esc(g.word)}</span></span>`;
}

/** Load-bearing untested premises: the premises pack's warnings. */
export function loadBearing(b: Bundle): string[] {
  return b.findings.filter((f) => f.pack === "premises" && f.rule === "load-bearing-untested").map((f) => f.at);
}

/** The Strategy brief: how many claims of each kind, how they are graded, and which untested ones carry the most. */
export function strategyBrief(b: Bundle): string {
  const cs = b.model.claims ?? [];
  if (!cs.length) return "This design declares no claims yet.";
  const kinds = ["premise", "claim", "assumption"].map((k) => [k, cs.filter((c) => c.kind === k).length] as const).filter(([, n]) => n);
  const grades = ["evidence", "inference", "judgment", "untested"].map((g) => [g, cs.filter((c) => c.grade === g).length] as const).filter(([, n]) => n);
  const parts: string[] = [];
  parts.push(`The design rests on ${list(kinds.map(([k, n]) => count(n, KIND_WORD[k][0], KIND_WORD[k][1])))}`);
  const phrase = (g: string, n: number) => g === "judgment" ? (n === 1 ? "1 is a judgment call" : `${fmt(n)} are judgment calls`) : `${fmt(n)} ${n === 1 ? "is" : "are"} ${GRADE[g].long}`;
  parts.push(`By grade, ${list(grades.map(([g, n]) => phrase(g, n)))}`);
  const lb = loadBearing(b);
  const ims = b.premises ?? {};
  if (lb.length) {
    const top = [...lb].sort((x, y) => (ims[y] ? weight(ims[y]) : 0) - (ims[x] ? weight(ims[x]) : 0) || natural(x, y))[0];
    const topName = quote(claimShort(cs.find((c) => c.id === top)?.statement ?? top, 70));
    parts.push(lb.length === 1 ? `One untested premise carries much of the design; it is ${topName}, with ${count(ims[top] ? weight(ims[top]) : 0, "record")} resting on it` : `Of the untested premises, ${fmt(lb.length)} carry much of the design; the heaviest is ${topName}, with ${count(ims[top] ? weight(ims[top]) : 0, "record")} resting on it`);
  } else parts.push("No untested premise carries much of the design");
  return para(parts);
}

/** What is built on a claim before its first test, in words: the row's number and the claim page's lead. */
export function exposureLine(b: Bundle, c: Claim): { short: string; long: string } {
  const im = b.premises?.[c.id], ex = im?.exposure;
  const name = (p: string) => quote(b.plan.phases.find((x) => x.id === p)?.name ?? (p.includes(":") ? `a milestone in ${p.split(":")[0]}` : p));
  if (!im || !ex) return { short: "", long: "" };
  const units = (n: number) => count(n, "open unit");
  if (ex.outsidePlanOrder?.length) {
    const where = `settled in ${list(ex.outsidePlanOrder)}, outside this design's plan order`;
    return { short: where, long: `It is ${where}. ${units(ex.before)} in this design ${ex.before === 1 ? "rests" : "rest"} on it.` };
  }
  if (ex.firstTest) {
    const where = `Its first test lands in ${name(ex.firstTest.phase)}`;
    return ex.before
      ? { short: `${units(ex.before)} before its first test`, long: `${where}; ${units(ex.before)} in earlier milestones ${ex.before === 1 ? "is" : "are"} built on it first.` }
      : { short: "tested before work rests on it", long: `${where}, before any open work in an earlier milestone is built on it.` };
  }
  if (c.grade === "evidence") return { short: im.openUnits ? `${units(im.openUnits)} ${im.openUnits === 1 ? "rests" : "rest"} on it` : "", long: "" };
  return ex.before
    ? { short: `no test; ${units(ex.before)} ${ex.before === 1 ? "rests" : "rest"} on it`, long: `No work tests this, and ${units(ex.before)} ${ex.before === 1 ? "is" : "are"} built on it.` }
    : { short: "no test", long: "" };
}

function claimRow(b: Bundle, c: Claim, lb: Set<string>): string {
  const im = b.premises?.[c.id];
  const w = im ? weight(im) : 0;
  const ex = exposureLine(b, c);
  const untestedNoTest = c.grade !== "evidence" && !(im?.exposure?.tests.length);
  const tags = [`<span class="tag">${esc((KIND_WORD[c.kind]?.[0] ?? c.kind).replace(/^./, (x) => x.toUpperCase()))}</span>`];
  if (lb.has(c.id)) tags.push(`<span class="tag warning">Untested, and much rests on it</span>`);
  if (untestedNoTest && w) tags.push(`<span class="tag warning no-test">No work tests it</span>`);
  if (c.fallback) tags.push(`<span class="tag">Has a fallback</span>`);
  if (im?.flow?.holds !== undefined) tags.push(im.flow.holds ? `<span class="tag${im.flow.source === "tracker" ? " accent" : ""}">${im.flow.source === "tracker" ? "The tracker's flow measure supports it" : "Holds on declared flow values"}</span>` : `<span class="tag warning">The flow measure contradicts it</span>`);
  const stake = im?.atStake ?? [];
  const msName = (p: string) => quote(b.plan.phases.find((x) => x.id === p)?.name ?? p);
  if (stake.length) tags.push(`<span>rests on it directly: ${esc(list(stake.map(msName), { max: 2 }))}</span>`);
  const amber = (im?.amberBy ?? []).filter((p) => !stake.includes(p));
  if (amber.length) tags.push(`<span>turns amber: ${esc(stake.length ? count(amber.length, "more milestone") : list(amber.map(msName), { max: 2 }))}</span>`);
  if (c.rests_on?.length) tags.push(`<span>rests on ${esc(count(c.rests_on.length, "other claim"))}</span>`);
  return `<li><a class="list-row" href="#strategy/claim/${encodeURIComponent(c.id)}" title="${esc(c.id)}" data-claim="${esc(c.id)}" data-grade="${esc(c.grade)}" data-kind="${esc(c.kind)}" data-text="${esc(`${c.id} ${c.statement} ${c.source ?? ""}`.toLowerCase())}">${gradeStatus(c.grade)}<span class="t">${esc(c.statement)}</span><span class="rv">${ex.short ? esc(ex.short) : w ? `${fmt(w)} ${w === 1 ? "rests" : "rest"} on it` : "nothing rests on it"}</span>
<span class="meta">${tags.join("")}</span></a></li>`;
}

export function reconciliationSection(b: Bundle): string {
  const data = b.premiseLinks;
  if (!data) return "";
  const d = data.debt, run = d.last_run;
  const group = (title: string, links: typeof data.links) => links.length ? `<h3>${title}</h3><ul class="rows">${links.map((l) => `<li>${esc(l.statements.from)} → ${esc(l.statements.to)}: ${esc(l.type.replace(/-/g, " "))} (${l.status})${l.changed.length ? `. Changed: ${esc(l.changed.map((side) => side === "from" ? "the premise at risk" : "the premise it rests on").join(" and "))}` : ""}</li>`).join("")}</ul>` : "";
  return `<section class="section" aria-labelledby="h-reconciliation"><div class="section-head"><h2 id="h-reconciliation">Reconciliation</h2><p>${count(d.found, "found link")} ${d.found === 1 ? "awaits" : "await"} a person. ${count(d.stale, "stale link")} ${d.stale === 1 ? "needs" : "need"} review. ${count(d.flags, "review flag")}.</p></div>${group("Found links awaiting a person", data.links.filter((l) => l.type === "depends-on" && l.status === "found"))}${group("Stale links", data.links.filter((l) => l.type === "depends-on" && l.status === "stale"))}${group("Review flags", data.links.filter((l) => l.type !== "depends-on"))}<p class="small fg2">${run ? esc(`The last run considered ${count(run.pairs_considered, "pair")} across ${run.designs.join(", ")} and skipped ${run.pairs_skipped}: ${run.rule}.`) : "No reconciliation run is recorded."}</p></section>`;
}

export function strategyPage(b: Bundle): string {
  const cs = b.model.claims ?? [];
  const lb = new Set(loadBearing(b));
  const ranked = rankByStakes(cs, b.premises ?? {});
  const chip = (f: string, v: string, label: string) => `<button type="button" class="fchip" data-cf="${f}" data-v="${esc(v)}" aria-pressed="false">${esc(label)}</button>`;
  const grades = ["untested", "judgment", "inference", "evidence"].filter((g) => cs.some((c) => c.grade === g));
  const kinds = ["premise", "claim", "assumption"].filter((k) => cs.some((c) => c.kind === k));
  return `<section class="page" id="strategy" data-page="strategy" aria-labelledby="h-strategy">
<div class="page-head"><h1 id="h-strategy" tabindex="-1">Strategy</h1></div>
<div class="plan-layout" id="strategy-layout"><div class="plan-main" style="min-width:0">
${reconciliationSection(b)}
<p class="brief" id="strategy-brief">${esc(strategyBrief(b))}</p>
${cs.length ? `<section aria-labelledby="h-claims"><div class="section-head"><h2 id="h-claims">What the design is betting on</h2><p>The least tested first, then the most work built on each before its first test lands: the next bet to test is at the top. Open one to see what would be in question if it were false</p></div>
<div class="chipbar" id="claim-filters" role="group" aria-label="Filter claims" style="margin-bottom:var(--sp-2)" hidden>${grades.map((g) => chip("grade", g, GRADE[g].word)).join("")}${kinds.length > 1 ? kinds.map((k) => chip("kind", k, KIND_WORD[k][1].replace(/^./, (x) => x.toUpperCase()))).join("") : ""}<label class="field grow" style="min-width:160px"><span class="sr-only">Search claims</span><input type="search" id="claim-text" placeholder="Search claims" autocomplete="off"></label></div>
<p class="filter-count" id="claim-count" aria-live="polite">${count(cs.length, "claim")}</p>
<ul class="panel claim-list" id="claim-list" style="padding:0;list-style:none">${ranked.map((c) => claimRow(b, c, lb)).join("")}</ul>
<p class="empty" id="claim-none" hidden>No claims match these filters.</p></section>`
    : `<p class="empty">Declare what the design rests on under <code>claims:</code> in <code>model.yaml</code> (id, statement, kind, grade, source, fallback), and name them from parts, relationships, units and milestones with <code>rests_on</code>.</p>`}
</div>
<aside class="plan-aside" id="claim-aside" aria-label="Claim detail" hidden><div class="inspector" id="claim-detail" tabindex="-1"></div></aside>
</div>
</section>`;
}

/** The Notes brief: open questions first, then notes, then what is answered and waiting to be resolved. */
export function notesBrief(notes: Note[]): string {
  if (!notes.length) return "No notes yet. Pin a note or a question to any part, unit, milestone, claim, patch or finding from its detail.";
  const oq = notes.filter((n) => n.status === "open" && n.kind === "question").length;
  const on = notes.filter((n) => n.status === "open" && n.kind === "note").length;
  const ans = notes.filter((n) => n.status === "answered").length;
  const res = notes.filter((n) => n.status === "resolved").length;
  const parts = [oq || on ? `Open now: ${list([oq ? count(oq, "question") : "", on ? count(on, "note") : ""])}` : "Nothing is open"];
  if (ans) parts.push(`Answered and waiting to be resolved: ${count(ans, "question")}`);
  if (res) parts.push(`Resolved: ${count(res, "note")}`);
  return para(parts);
}

/** Where notes and questions come from, said once on the Notes page. */
export const NOTES_SOURCE = "Notes and questions live in notes.yaml beside the model. People write them, agents such as Claude write them, and this page writes them when it is served by bun plumb.ts dev. Nothing is pulled from a tracker, chat or any other tool.";

export function notesPage(b: Bundle): string {
  const notes = b.notes?.items ?? [];
  const opt = (vals: [string, string][]) => vals.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const kinds = [...new Set(notes.map((n) => n.target.kind))].sort();
  return `<section class="page" id="notes" data-page="notes" aria-labelledby="h-notes">
<div class="page-head"><h1 id="h-notes" tabindex="-1">Notes</h1></div>
<p class="brief" id="notes-brief">${esc(notesBrief(notes))}</p>
<p class="small fg2" id="notes-source">${esc(NOTES_SOURCE)}</p>
<div id="notes-mode"></div>
<form class="filters" id="note-filters" role="search" aria-label="Filter notes" onsubmit="return false">
<label class="field grow">Search<input type="search" id="nf-text" placeholder="Text, answer, record id" autocomplete="off"></label>
<label class="field">Status<select id="nf-status"><option value="">All</option>${opt([["open", "Open"], ["answered", "Answered"], ["resolved", "Resolved"]])}</select></label>
<label class="field">Kind<select id="nf-kind"><option value="">All</option>${opt([["question", "Questions"], ["note", "Notes"]])}</select></label>
<label class="field">Pinned to<select id="nf-target"><option value="">Anything</option>${opt(kinds.map((k) => [k, k]))}</select></label>
<button type="reset" class="btn">Clear</button>
</form>
<p class="filter-count" id="note-count" aria-live="polite">${count(notes.length, "note")}</p>
<ul class="note-list" id="note-list">${notes.map((n) => `<li class="note-card" data-note="${esc(n.id)}"><p class="small fg2"><span class="id">${esc(n.id)}</span> ${esc(n.kind === "question" ? "Question" : "Note")} · ${esc(n.status)} · on ${esc(n.target.kind)} <span class="id">${esc(n.target.id)}</span></p><p>${esc(n.text)}</p>${n.answer ? `<p class="small"><b>Answer:</b> ${esc(n.answer)}</p>` : ""}</li>`).join("")}</ul>
<p class="empty" id="note-none" hidden>No notes match these filters.</p>
</section>`;
}

// ---------- compared builds (bun plumb.ts diff --save) ----------

const DIFF_KIND: Record<string, [string, string]> = { element: ["part", "parts"], relationship: ["relationship", "relationships"], unit: ["unit", "units"], claim: ["claim", "claims"], finding: ["finding", "findings"], patch: ["patch", "patches"], note: ["note", "notes"] };

/** One sentence for a comparison: what grew, what went, which findings moved. */
export function diffSentence(d: BuildDiff): string {
  const grew = Object.entries(d.counts).filter(([k, c]) => k !== "finding" && c.added).map(([k, c]) => count(c.added, DIFF_KIND[k]?.[0] ?? k, DIFF_KIND[k]?.[1]));
  const went = Object.entries(d.counts).filter(([k, c]) => k !== "finding" && c.removed).map(([k, c]) => count(c.removed, DIFF_KIND[k]?.[0] ?? k, DIFF_KIND[k]?.[1]));
  const changed = Object.entries(d.counts).filter(([k, c]) => k !== "finding" && c.changed).reduce((n, [, c]) => n + c.changed, 0);
  const parts = [grew.length ? `It adds ${list(grew)}` : "It adds no records", went.length ? `removes ${list(went)}` : "", changed ? `and changes ${count(changed, "record")}` : ""].filter(Boolean);
  const f = [d.findings.added.length ? `${count(d.findings.added.length, "new finding")}` : "", d.findings.gone.length ? `${count(d.findings.gone.length, "finding")} gone` : ""].filter(Boolean);
  return para([parts.join(", ").replace(/, and /, " and "), f.length ? `Checks: ${list(f)}` : "Checks report the same findings"]);
}

function recList(title: string, xs: DiffRecord[], max = 12): string {
  if (!xs.length) return "";
  return `<details class="disc"><summary>${esc(title)} <span class="count">${xs.length}</span></summary><div class="body"><ul class="rows">${xs.slice(0, max).map((x) => `<li><span class="tag">${esc(DIFF_KIND[x.kind]?.[0] ?? x.kind)}</span> <span class="id">${esc(x.id)}</span> ${esc(x.name)}</li>`).join("")}${xs.length > max ? `<li class="muted small">and ${fmt(xs.length - max)} more</li>` : ""}</ul></div></details>`;
}

/** A side of a comparison by name and date: "edition 1.4, built 22 Oct 2026", "bundle.json, built 21 Oct 2026". */
export function sideName(s: { label: string; built?: string }): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s.built ?? "");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return m && !/\d{4}-\d\d-\d\d/.test(s.label) ? `${s.label}, built ${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : s.label;
}

export function comparisonsSection(b: Bundle): string {
  const cs = b.comparisons ?? [];
  if (!cs.length) return "";
  const nm = DIGEST.names(b);
  return `<section class="section" id="comparisons" aria-labelledby="h-cmp"><div class="section-head"><h2 id="h-cmp">Compared builds</h2><p>Saved by <code>bun plumb.ts diff --save</code></p></div>
${cs.map((d, i) => `<article class="panel pad cmp" id="cmp-${i}" style="margin-bottom:var(--sp-4)"><h3>${esc(sideName(d.from))} <span role="img" aria-label="to">&#8594;</span> ${esc(sideName(d.to))}</h3>
<p class="reading" style="margin:6px 0 var(--sp-3)">${esc(diffSentence(d))}</p>
${DIGEST.churnText(d, d.importer) ? `<p class="small fg2">${esc(DIGEST.churnText(d, d.importer))}</p>` : ""}
${d.status && (d.status.overall || d.status.moves.length) ? `<h4 class="small fg2" style="margin-top:var(--sp-3)">Status moves</h4><ul class="rows">${d.status.overall ? `<li>${esc(`The plan went ${d.status.overall.from} to ${d.status.overall.to}`)}</li>` : ""}${d.status.moves.map((m) => `<li>${esc(DIGEST.moveText(m))}</li>`).join("")}</ul>` : ""}
<div class="table-wrap"><table><caption class="sr-only">Records by kind</caption><thead><tr><th scope="col">Kind</th><th scope="col" class="n">Added</th><th scope="col" class="n">Removed</th><th scope="col" class="n">Changed</th><th scope="col" class="n">Reworded</th></tr></thead><tbody>${Object.entries(d.counts).filter(([, c]) => c.added || c.removed || c.changed || c.reworded).map(([k, c]) => `<tr><td>${esc((DIFF_KIND[k]?.[1] ?? k).replace(/^./, (x) => x.toUpperCase()))}</td><td class="n">${fmt(c.added)}</td><td class="n">${fmt(c.removed)}</td><td class="n">${fmt(c.changed)}</td><td class="n">${fmt(c.reworded ?? 0)}</td></tr>`).join("")}</tbody></table></div>
${recList("New risks", d.risks ?? [])}${(d.fields ?? []).length ? `<h4 class="small fg2" style="margin-top:var(--sp-3)">Changed fields <span class="count">${fmt(d.fields!.length)}</span></h4><ul class="rows">${d.fields!.slice(0, 30).map((x) => `<li><span title="${esc(x.id)}">${esc(x.name)}</span>: <span class="small fg2">${esc(DIGEST.fieldText(x, nm))}</span></li>`).join("")}${d.fields!.length > 30 ? `<li class="xs muted">and ${fmt(d.fields!.length - 30)} more</li>` : ""}</ul>` : ""}
${recList("New problems", d.findings.added)}${recList("Problems gone", d.findings.gone)}${recList("Claims regraded", d.claims.regraded.map((c) => ({ ...c, name: `${c.name} (${c.from} → ${c.to})` })))}${recList("Records added", d.added)}${recList("Records removed", d.removed)}${recList("Records changed", d.changed)}
</article>`).join("")}</section>`;
}

export { quote };
