// The portfolio page: one self-contained file, in the instance pages' tokens, icons and cards.
//
// renderPortfolio(data) is pure and synchronous: the same portfolio.json in, the same page out, and no DOM needed.
// Every section is static markup, so the page reads without JavaScript: the opening sentence and the mode line, the
// designs, the roadmap across designs, load by team (most contended first), the most contended team, the seams, the
// slowdown bets, the flow distribution, every estimate, the root's changes and the checks. The small client
// (client/portfolio.js) adds the theme, the focus across designs, the estimates' team filter and hover cards; it opens
// no connection and sets no repeating timer. Charts are SVG or plain boxes laid out here.
import type { PortfolioData, PortfolioPageFacts, RoadmapMilestone, TeamLoad, SeamPageView, EstimateRow } from "../types.ts";
import { CSS, PORTFOLIO_CSS } from "./styles.ts";
import { esc, inlineJson, inlineScript } from "./html.ts";
import { count, fmt, list, quote, sentence } from "./prose.ts";
import { FAVICON, SPRITE } from "./render.ts";
import { ragHtml } from "./status.ts";
import { monthWords, possessive, shortDay, slots } from "./portfolio-facts.ts";
import CLIENT_PROSE from "./client/prose.js" with { type: "text" };
import CLIENT_PORTFOLIO from "./client/portfolio.js" with { type: "text" };

/** The page's script: the prose helpers and the portfolio client in one function; it boots when the page holds its data. */
export const PORTFOLIO_JS = `var PF = (function () {\n"use strict";\nvar api = {};\n${CLIENT_PROSE}\napi.prose = PROSE;\n${CLIENT_PORTFOLIO}\nreturn api;\n})();
if (typeof document !== "undefined" && document.getElementById && document.getElementById("de-portfolio")) {
  try { PF.boot(); } catch (e) { if (typeof console !== "undefined") console.error("Plumb: the portfolio script failed", e); }
}
`;

const icon = (name: string, cls = "icon") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const UNIT_WORD: Record<string, string> = { done: "Done", doing: "In progress", ready: "Ready", blocked: "Blocked" };
/** A unit's state as the design pages draw it, with its word for a screen reader. */
function unitIcon(data: PortfolioData, unit: string): string {
  const u = data.load?.units[unit];
  const st = !u ? "blocked" : u.status === "done" ? "done" : u.status === "doing" ? "doing" : u.ready ? "ready" : "blocked";
  return `${icon(st, `icon icon-sm st-${st}`)}<span class="sr-only">${UNIT_WORD[st]}: </span>`;
}
const sevIcon = (sev: string) => icon(sev === "error" ? "fail" : "warning", `icon st-${sev === "error" ? "fail" : "warning"}`);
const num = (x: number) => fmt(Math.round(x * 100) / 100);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const attr = (s: string) => esc(s);
const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, "");
/** A design's label without its title, for a place that already shows the title: "Working copy, no accepted patches since 1.0.0", "Released 1.0.0 (28 Oct)". */
export function shortLabel(title: string, label: string): string {
  if (label.startsWith(`${title}: `)) { const r = label.slice(title.length + 2); return r.charAt(0).toUpperCase() + r.slice(1); }
  if (label.startsWith(`${title} `)) return `Released ${label.slice(title.length + 1)}`;
  return label;
}

/** The sections, in the page's order: the nav links to each. */
export const PORTFOLIO_SECTIONS = [
  ["designs", "Designs"], ["roadmap", "Roadmap"], ["load", "Load"], ["contended", "Most contended"], ["seams", "Seams"],
  ["slowdowns", "Slowdowns"], ["flow", "Flow"], ["estimates", "Estimates"], ["changes", "Changes"], ["checks", "Checks"],
] as const;

/** A heading's text with the first use of each glossary term marked, as the instance pages mark their section headings. */
function glossed(text: string, page: PortfolioPageFacts, seen: Set<string>): string {
  const forms: { f: string; t: { term: string; definition: string } }[] = [];
  for (const t of page.glossary) for (const f of [t.term, ...(t.forms ?? [])]) forms.push({ f, t });
  forms.sort((a, b) => b.f.length - a.f.length);
  const lower = text.toLowerCase();
  for (const { f, t } of forms) {
    if (seen.has(t.term)) continue;
    const i = lower.search(new RegExp(`(^|[^a-z0-9-])${f.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`));
    if (i < 0) continue;
    const at = lower.slice(i).startsWith(f.toLowerCase()) ? i : i + 1;
    seen.add(t.term);
    return `${esc(text.slice(0, at))}<span class="gl" tabindex="0" role="term" data-gl="${attr(t.term)}" data-hover="${attr(`${t.term.charAt(0).toUpperCase()}${t.term.slice(1)}: ${t.definition}`)}">${esc(text.slice(at, at + f.length))}</span>${esc(text.slice(at + f.length))}`;
  }
  return esc(text);
}

function sectionHead(id: string, title: string, note: string, page: PortfolioPageFacts, seen: Set<string>): string {
  return `<div class="section-head"><h2 id="h-${id}" tabindex="-1">${glossed(title, page, seen)}</h2>${note ? `<p>${esc(note)}</p>` : ""}</div>`;
}

// ---------- header, nav and mode ----------

function header(data: PortfolioData): string {
  return `<header class="app-header"><div class="inner">
<span class="mark">${icon("mark", "")}<span class="words">Plumb</span></span>
<span class="app-title" title="${attr(data.portfolio.title)}">${esc(data.portfolio.title)}</span>
<div class="hdr-actions">
<span class="menu-wrap"><button type="button" class="btn focus-btn" id="focus-btn" aria-haspopup="true" aria-expanded="false" aria-pressed="false" hidden>${icon("focus")}<span class="lbl">Focus</span></button><span class="menu right pf-menu" role="menu" id="focus-menu" aria-label="Focus on a team or a lead" hidden></span></span>
<span class="menu-wrap"><button type="button" class="btn quiet icon-only" id="theme-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu" aria-label="Colour theme" hidden>${icon("theme")}</button>
<span class="menu right" role="menu" id="theme-menu" aria-label="Colour theme" hidden>
<button type="button" role="menuitemradio" data-theme-set="auto" aria-checked="true">Auto</button>
<button type="button" role="menuitemradio" data-theme-set="light" aria-checked="false">Light</button>
<button type="button" role="menuitemradio" data-theme-set="dark" aria-checked="false">Dark</button></span></span>
</div></div></header>`;
}

function nav(): string {
  return `<nav class="app-nav pf-nav" aria-label="Sections"><div class="inner"><div class="pf-links">${PORTFOLIO_SECTIONS.map(([id, label]) => `<a href="#${id}" data-nav="${id}">${esc(label)}</a>`).join("")}</div></div></nav>`;
}

/** The mode bar: which view this is, in words, on every page built inside the portfolio. */
function modeBar(page: PortfolioPageFacts): string {
  const presenting = page.mode.mode === "presenting";
  return `<div class="pf-mode${presenting ? " presenting" : ""}" role="note" aria-label="What this page shows"><div class="inner"><span class="tag${presenting ? " accent" : ""} pf-mode-tag">${icon(presenting ? "present" : "k-patch", "icon icon-sm")}${esc(page.mode.head)}</span><span class="pf-mode-line">${esc(page.mode.line.replace(`${page.mode.head} · `, ""))}</span><span id="pf-focus-chip" class="pf-focus-chip"></span></div></div>`;
}

// ---------- designs ----------

function designs(data: PortfolioData, page: PortfolioPageFacts, seen: Set<string>): string {
  const tiles = page.roadmap.rows.map((r) => {
    const cur = r.milestones.find((m) => m.current);
    const errors = r.counts.errors, warnings = r.counts.warnings;
    return `<a class="tile pf-design" href="${attr(r.href)}" data-design="${attr(r.design)}"><span class="q">${esc(shortLabel(r.title, r.label))}</span>
<span class="big">${esc(r.title)}</span>
<span class="line">${r.status ? ragHtml(r.status, "sm") + " · " : ""}${cur ? `current milestone ${esc(quote(cur.name))}` : r.milestones.length ? "every milestone reached" : "no milestones yet"}</span>
<span class="line">${esc(`${fmt(r.counts.done)} of ${count(r.counts.units, "unit")} done`)} · ${errors ? `<span class="st fail sm">${icon("fail", "icon icon-sm")}<span class="w">${esc(count(errors, "error"))}</span></span>` : "no errors"}${warnings ? ` · ${esc(count(warnings, "warning"))}` : ""}</span>
<span class="line pf-open">Open its page</span></a>`;
  }).join("\n");
  return `<section class="section" id="designs" aria-labelledby="h-designs">${sectionHead("designs", "Designs", `${count(data.designs.length, "design")} over one shared root. Each opens its own page, built inside this portfolio.${data.premiseLinks ? ` Reconciliation: ${count(data.premiseLinks.debt.found, "found link")} ${data.premiseLinks.debt.found === 1 ? "awaits" : "await"} a person, ${count(data.premiseLinks.debt.stale, "stale link")} and ${count(data.premiseLinks.debt.flags, "review flag")}.` : ""}`, page, seen)}
<div class="tiles" style="--tiles:${Math.min(3, Math.max(1, page.roadmap.rows.length))}">${tiles}</div></section>`;
}

// ---------- the roadmap ----------

function milestoneCard(m: RoadmapMilestone, page: PortfolioPageFacts, col: number, span = 1, phase?: number): string {
  const when = phase !== undefined ? `Phase ${phase}` : m.late ? `Target ${shortDay(m.target, page.today)} passed` : m.month ? monthWords(m.month) : `Later: target ${shortDay(m.target, page.today)}`;
  const hover = [`${m.name}${m.target ? `, target ${shortDay(m.target, page.today)}` : ""}${m.late ? ", passed and not reached" : ""}.`, m.delivers ? `Delivers: ${m.delivers}` : "", m.statusWhy ? `Status: ${m.statusWhy}` : "", m.lead ? `Lead: ${m.lead}` : ""].filter(Boolean).join("\n");
  const reliefs = m.reliefs.length ? `<span class="rm-relief">${icon("k-team", "icon icon-sm")}<span>Capacity returns: ${esc(list(m.reliefs.map((r) => `${r.teamName}${r.slots !== undefined && r.slots > 0.004 ? ` +${one(r.slots)} ${Math.abs(Number(one(r.slots)) - 1) < 1e-9 ? "slot" : "slots"}` : ""}`)))}</span></span>` : "";
  const reliefHover = m.reliefs.map((r) => r.text).join("\n");
  const progress = phase !== undefined || m.open ? `${fmt(m.open)} of ${count(m.total, "unit")} open` : m.total ? "all units done" : "no units";
  return `<li class="rm-ms${m.current ? " current" : ""}${m.status ? ` rag-${m.status}` : ""}" style="--col:${col};--span:${span}" data-ms="${attr(m.id)}" data-hover="${attr([hover, reliefHover].filter(Boolean).join("\n"))}">
<a href="${attr(m.href)}"><span class="rm-when">${esc(when)}</span>${m.status ? ragHtml(m.status, "sm") : ""}${m.manual ? `<span class="tag">Manual status</span>` : ""}<span class="rm-name">${esc(m.name)}</span><span class="rm-meta">${esc(`${m.reached ? "Reached · " : m.current ? "Current · " : ""}${progress}`)}</span></a>${reliefs}<span class="fz-share" hidden></span></li>`;
}

function roadmap(page: PortfolioPageFacts, seen: Set<string>): string {
  const months = page.roadmap.months;
  const later = page.roadmap.rows.some((r) => r.milestones.some((m) => m.beyond));
  const earlier = page.roadmap.rows.some((r) => r.milestones.some((m) => m.month && m.month < months[0]));
  const dated = page.roadmap.rows.some((r) => r.milestones.some((m) => m.target && !m.reached));
  const cols = months.length + Number(later) + Number(earlier);
  const colOf = (m: RoadmapMilestone) => (m.month ? m.month < months[0] ? 1 : months.indexOf(m.month) + 1 + Number(earlier) : months.length + 1 + Number(earlier));
  const head = dated ? `<ol class="rm-months" aria-hidden="true" style="--cols:${cols}">${earlier ? "<li>Earlier</li>" : ""}${months.map((mo, i) => `<li${i === 0 ? ' class="now"' : ""}>${esc(monthWords(mo).replace(/ \d{4}$/, (y) => (mo.endsWith("-01") || i === 0 ? y : "")))}</li>`).join("")}${later ? "<li>Later</li>" : ""}</ol>` : "";
  const rows = page.roadmap.rows.map((r) => {
    const reached = r.milestones.filter((m) => m.reached && m.target);
    const open = r.milestones.filter((m) => !m.reached && m.target);
    const phases = r.milestones.filter((m) => !m.target);
    const waits = r.waits.filter((w) => !w.done);
    return `<div class="rm-row" data-design="${attr(r.design)}">
<div class="rm-head"><a href="${attr(r.href)}" class="rm-title">${esc(r.title)}</a><span class="rm-label">${esc(shortLabel(r.title, r.label))}</span>${r.status ? `<span class="rm-status">${ragHtml(r.status, "sm")}</span>` : ""}${reached.length ? `<span class="rm-reached">${icon("done", "icon icon-sm st-done")}Reached: ${esc(list(reached.map((m) => quote(m.name))))}</span>` : ""}<span class="fz-none" hidden></span></div>
${open.length ? `<ol class="rm-track" aria-label="Dated milestones" style="--cols:${cols}">${open.map((m, i) => { const c = colOf(m), next = open.slice(i + 1).map(colOf).filter((x) => x > c); return milestoneCard(m, page, c, Math.max(1, Math.min(3, (next.length ? Math.min(...next) : cols + 1) - c))); }).join("")}</ol>` : phases.length ? "" : `<p class="rm-empty">${r.milestones.length ? "Every milestone is reached." : "No milestones yet."}</p>`}
${phases.length ? `<ol class="rm-phases" aria-label="Phases in plan order">${phases.map((m) => milestoneCard(m, page, 1, 1, r.milestones.indexOf(m) + 1)).join("")}</ol>` : ""}
${waits.length ? `<ul class="rm-waits">${waits.map((w) => `<li data-unit="${attr(w.unit)}">${icon("blocked", "icon icon-sm st-blocked")}${esc(w.text)}</li>`).join("")}</ul>` : ""}
</div>`;
  }).join("\n");
  const anyWait = page.roadmap.rows.some((r) => r.waits.some((w) => !w.done));
  const anyRelief = page.roadmap.rows.some((r) => r.milestones.some((m) => m.reliefs.length));
  return `<section class="section" id="roadmap" aria-labelledby="h-roadmap">${sectionHead("roadmap", "Roadmap across designs", `Dated milestones sit in their target months. Milestones without dates follow in plan order. Each shows its status and open work. Hover a milestone for what it delivers.`, page, seen)}
<div class="rm">${head}${rows}</div>
${anyRelief ? `<p class="small fg2">${icon("k-team", "icon icon-sm")} Capacity returns when the milestone lands, if on target: each team's slots back for good, against the share as written. A slowdown running meanwhile is on the team's load below.</p>` : ""}
${anyWait ? "" : `<p class="small muted">No open unit waits on another design's work.</p>`}</section>`;
}

// ---------- load by team ----------

const DESIGN_TONES = ["z1", "z3", "z5", "z4", "z6", "z2"];

function loadBar(t: TeamLoad, data: PortfolioData, tone: (ns: string) => string): string {
  if (t.capacity === undefined) return `<p class="callout">${icon("info")}<span>Capacity not stated: no limit to compare its ${count(t.doing.length, "unit")} in doing against. Ask ${esc(t.lead ?? "its lead")} to state one.</span></p>`;
  const C = t.capacity;
  const L = data.load!;
  const shareSlots = t.shares.map((s) => ({ ...s, slots: s.slots ?? s.share * C }));
  const used = shareSlots.reduce((n, s) => n + s.slots, 0) + t.doing.length;
  const scale = Math.max(C, used) || 1;
  const w = (x: number) => `${Math.max(0, (x / scale) * 100).toFixed(2)}%`;
  const titleOf = (ns: string) => data.designs.find((d) => d.namespace === ns)?.title ?? ns;
  const segs: string[] = [];
  const legend: string[] = [];
  let at = 0;
  /** One block, split where it crosses the limit: the part past it is the overrun. */
  const block = (size: number, cls: string, label: string, title: string) => {
    const within = Math.max(0, Math.min(size, C - at)), past = size - within;
    if (within > 1e-9) segs.push(`<span class="lb-seg ${cls}" style="width:${w(within)}" title="${attr(title)}"><span class="lb-t">${esc(label)}</span></span>`);
    if (past > 1e-9) segs.push(`<span class="lb-seg ${cls} over" style="width:${w(past)}" title="${attr(`${title}: past the limit`)}"><span class="lb-t">${esc(within > 1e-9 ? "" : label)}</span></span>`);
    at += size;
  };
  for (const s of shareSlots) {
    if (s.slots <= 1e-9) continue;
    block(s.slots, s.type === "bau" ? "bau" : "stream", s.name, `${s.name}: ${num(s.slots)} of ${C} slots (${pct(s.share)})`);
    legend.push(`<li><span class="lb-key ${s.type === "bau" ? "bau" : "stream"}"></span>${esc(`${s.name}: ${slots(s.slots)}, ${s.type === "bau" ? "keeping the lights on" : "another stream"}${s.why.length ? ` (${s.why.join("; ")})` : ""}`)}</li>`);
  }
  for (const d of t.doingBy) {
    for (const u of t.doing.filter((x) => L.units[x]?.design === d.design)) {
      const lu = L.units[u];
      block(1, `unit ${tone(d.design)}${lu?.transition ? " transition" : ""}`, lu?.title ?? u, `${titleOf(d.design)}: ${quote(lu?.title ?? u)}, in doing${lu?.transition ? `, transition work${lu.discovered ? " resting on a discovered record" : ""}` : ""}`);
    }
    legend.push(`<li><span class="lb-key unit ${tone(d.design)}"></span>${esc(`${titleOf(d.design)}: ${count(d.units, "unit")} in doing${d.transition ? `, ${fmt(d.transition)} of them transition work${d.discovered ? ` (${fmt(d.discovered)} resting on a discovered record)` : ""}` : ""}`)}</li>`);
  }
  const free = t.free ?? 0;
  if (free > 1e-9) { segs.push(`<span class="lb-seg free" style="width:${w(free)}" title="${attr(`${slots(free)} free`)}"><span class="lb-t">${esc(`${num(free)} free`)}</span></span>`); legend.push(`<li><span class="lb-key free"></span>${esc(`${slots(free)} free for design work`)}</li>`); }
  if (free < -1e-9) legend.push(`<li class="warn-text"><span class="lb-key over"></span>${esc(`Over by ${slots(-free)}`)}</li>`);
  const limitAt = (C / scale) * 100;
  const unc = t.unclassified ? `<div class="lb-unc" style="width:${w(t.unclassified.slots ?? t.unclassified.share * C)}" title="${attr(`Unclassified time in the tracker: ${pct(t.unclassified.share)} of time in doing, measured ${t.unclassified.as_of}`)}"><span class="lb-t">${esc(`Unclassified ${pct(t.unclassified.share)}`)}</span></div>` : "";
  return `<div class="lb" role="img" aria-label="${attr(`${t.name}: limit ${C}; ${list(legend.map((l) => l.replace(/<[^>]+>/g, "")))}`)}"><div class="lb-bar">${segs.join("")}</div><span class="lb-limit${limitAt > 80 ? " end" : ""}" style="left:${limitAt.toFixed(2)}%"><span>${esc(`limit ${C}`)}</span></span></div>
${unc ? `<div class="lb-unc-row">${unc}<span class="small muted">${esc(`Tracker time no rule classifies, ${pct(t.unclassified!.share)} as of ${shortDay(t.unclassified!.as_of, data.page?.today)}: shown apart, never spread over the activities or counted in the allowance.`)}</span></div>` : ""}
<ul class="lb-legend">${legend.join("")}</ul>`;
}

/** The standing band month by month against the limit: a column per month, its lower part what keeps the lights on and other streams take. */
function timeline(t: TeamLoad, page: PortfolioPageFacts): string {
  if (t.capacity === undefined) return "";
  const C = t.capacity;
  let prev = -1;
  const cols = t.timeline.months.map((m) => {
    const standing = Math.min(1, m.standing);
    // the slots the standing load takes, written where it changes, so a step reads without hovering
    const v = Math.round(standing * C * 100) / 100, changed = v !== prev; prev = v;
    return `<li style="--s:${(standing * 100).toFixed(1)}%" title="${attr(`${monthWords(m.month)}: ${slots(standing * C)} to keeping the lights on and other streams; allowance ${slots(m.allowance ?? C * (1 - standing))}`)}"><span class="tl-col"><span class="tl-s"></span>${changed ? `<span class="tl-v">${esc(num(v))}</span>` : ""}</span><span class="tl-m">${esc(monthWords(m.month).slice(0, 3))}</span></li>`;
  }).join("");
  const events = t.timeline.steps.flatMap((s) => s.events.map((e) => ({ ...e, date: e.date ?? s.from })));
  const changes = events.length || t.timeline.undated.length;
  return `<div class="tl"><p class="small fg2">${esc(changes ? "To the horizon: the standing load shrinks when a relief lands and dips while a slowdown runs." : "To the horizon: nothing brings its standing load down or lifts it.")}</p>
<ol class="tl-cols" aria-label="${attr(`${t.name}: standing load by month against its limit of ${C}`)}">${cols}</ol>
${events.length ? `<ul class="tl-events small">${events.map((e) => `<li data-hover="${attr(e.text)}"><span class="tl-date">${esc(shortDay(e.date, page.today))}</span> ${esc(e.text)}</li>`).join("")}</ul>` : ""}
${t.timeline.undated.length ? `<p class="small fg2">${esc(sentence(`Cannot be dated: ${list(t.timeline.undated.map((e) => e.text.replace(/[.\s]+$/, "")))}`))}</p>` : ""}</div>`;
}

function load(data: PortfolioData, page: PortfolioPageFacts, seen: Set<string>): string {
  const L = data.load;
  if (!L) return `<section class="section" id="load" aria-labelledby="h-load">${sectionHead("load", "Load by team", "", page, seen)}<p class="empty">The root has no org layer, so no team has a limit to read. Add org.yaml to the root to see load by team.</p></section>`;
  const tones = new Map(data.designs.map((d, i) => [d.namespace, DESIGN_TONES[i % DESIGN_TONES.length]]));
  const tone = (ns: string) => tones.get(ns) ?? "z0";
  const est = new Map(page.estimates.map((e) => [`${e.record} ${e.field}`, e]));
  const rows = L.teams.map((t) => {
    const flag = t.over ? `<span class="tag ${t.severity === "error" ? "danger" : "warning"}">${icon(t.severity === "error" ? "fail" : "warning", "icon icon-sm")}${t.severity === "error" ? "Over capacity, on a next milestone's path" : "Over capacity"}</span>` : t.capacity === undefined ? `<span class="tag">Capacity not stated</span>` : t.allTaken ? `<span class="tag warning">${icon("warning", "icon icon-sm")}No allowance left</span>` : `<span class="tag success">Within capacity</span>`;
    const provs: string[] = [];
    const cap = est.get(`${t.team} capacity`);
    if (cap) provs.push(provLine(cap));
    for (const s of t.shares) { const e = est.get(`${s.activity} share`); if (e) provs.push(provLine(e)); }
    const queue = t.ready.length ? `${count(t.ready.length, "more unit")} can start when a slot frees: ${list(t.ready.map((u) => quote(L.units[u]?.title ?? u)), { max: 4, more: "others" })}.` : "Nothing else of theirs can start now.";
    return `<article class="pf-team panel pad" data-team="${attr(t.team)}" id="team-${attr(t.team.replace(/[^a-z0-9-]/gi, "-"))}">
<div class="pf-team-head"><h3>${esc(t.name)}</h3>${flag}${t.lead ? `<span class="small muted">${esc(`Lead: ${t.lead}`)}</span>` : ""}</div>
<p class="fg2">${esc(t.text)}</p>
${loadBar(t, data, tone)}
<p class="small fg2 pf-queue">${esc(queue)}</p>
${provs.length ? `<ul class="prov small">${provs.join("")}</ul>` : ""}
${t.calibration ? `<p class="small fg2">${esc(t.calibration.text)}</p>` : ""}
${timeline(t, page)}
<span class="fz-share" hidden></span></article>`;
  }).join("\n");
  return `<section class="section" id="load" aria-labelledby="h-load">${sectionHead("load", "Load by team", "Pieces of work in progress against each team's limit, the most contended first. A unit and a ticket are not the same size: read these as pieces of work, never as person-days.", page, seen)}
<div class="pf-teams">${rows}</div>
${manualWork(data)}</section>`;
}

/** each kind of manual work, the activities that link it, and every unit in every design that relieves it, with its premise's grade; a unit the activity does not name yet is "not linked". */
function manualWork(data: PortfolioData): string {
  const kinds = (data.load?.manualWork ?? []).filter((k) => k.units.length || k.activities.length);
  if (!kinds.length) return "";
  const L = data.load!;
  const titleOf = (ns: string) => data.designs.find((d) => d.namespace === ns)?.title ?? ns;
  const actName = (id: string) => L.activities.find((a) => a.activity === id)?.name ?? id;
  const rows = kinds.map((k) => `<li class="pf-mw"><div><b>${esc(k.name)}</b> <span class="small fg2">${esc(k.activities.length ? `Kept up today by ${list(k.activities.map((a) => quote(actName(a))))}` : "No standing activity links it yet")}</span></div>
<ul class="rows small">${k.units.map((u) => `<li data-unit="${attr(u.unit)}">${unitIcon(data, u.unit)}<a href="${attr(`${encodeURIComponent(u.design)}/index.html#plan/unit/${encodeURIComponent(u.unit.split(":").slice(1).join(":"))}`)}">${esc(u.title)}</a><span class="muted">${esc(`${titleOf(u.design)}, ${u.effect === "retire" ? "retires it" : "reduces it"}${u.grade ? `, resting on a premise graded ${u.grade}` : ""}`)}</span>${u.linked ? "" : `<span class="tag warning">Not linked</span>`}</li>`).join("")}</ul></li>`).join("");
  return `<h3 class="pf-h3 pf-mw-h">Manual work and the units that relieve it</h3><p class="small fg2">Every unit, in every design, that relieves a kind of manual work. One the standing activity does not name as its relief yet is marked not linked: its payoff is not in the projection.</p><ul class="rows pf-mws">${rows}</ul>`;
}

/** One estimate's provenance line, its gap and its pending proposal, for a load row. */
function provLine(e: EstimateRow): string {
  const extra = [e.gap?.over ? `<span class="warn-text">${icon("warning", "icon icon-sm")}${esc(e.gap.text)}</span>` : "",
    e.payoff ? `<span class="${e.payoff.landed ? "" : "warn-text"}">${e.payoff.landed ? "" : icon("warning", "icon icon-sm")}${esc(e.payoff.text)}</span>` : "", ...e.pending.map((p) => `<span class="pending">${esc(p.text)}</span>`), e.rowOwner && !e.rowOwner.statedByOwner ? `<span class="muted">${esc(`Not stated by the row's owner, ${e.rowOwner.owner}`)}</span>` : ""].filter(Boolean);
  return `<li><span class="pv-what">${esc(e.what)}:</span> ${esc(e.provenance)}${e.stale ? ` <span class="tag warning">${icon("warning", "icon icon-sm")}Stale</span>` : ""}${extra.length ? ` · ${extra.join(" · ")}` : ""}</li>`;
}

// ---------- the most contended team ----------

function contended(data: PortfolioData, page: PortfolioPageFacts, seen: Set<string>): string {
  const L = data.load;
  const c = L?.contended;
  const titleOf = (ns: string) => data.designs.find((d) => d.namespace === ns)?.title ?? ns;
  const body = !L ? `<p class="empty">The root has no org layer, so no team is ranked.</p>`
    : !c ? `<p class="empty">No team owns open work on the paths to the next milestones.</p>`
    : `<div class="panel pad pf-contended" data-team="${attr(c.team)}"><p class="reading">${esc(c.text)}</p>
<ul class="rows">${c.units.map((u) => `<li data-unit="${attr(u.unit)}">${unitIcon(data, u.unit)}<a href="${attr(`${encodeURIComponent(u.design)}/index.html#plan/unit/${encodeURIComponent(u.unit.split(":").slice(1).join(":"))}`)}">${esc(u.title)}</a><span class="small muted">${esc(`${titleOf(u.design)}, toward ${quote(u.milestoneName ?? u.milestone)}`)}</span></li>`).join("")}</ul>
${c.next.length ? `<p class="small fg2">${esc(sentence(`Next: ${list(c.next.map((n) => `${n.name} (${n.ratio !== undefined ? `${num(n.ratio)} open ${Math.abs(n.ratio - 1) < 1e-9 ? "unit" : "units"} per slot of allowance` : `${count(n.open, "open unit")}, ${n.basis === "work alone" ? "capacity not stated" : n.basis}`})`))}`))}</p>` : ""}</div>`;
  return `<section class="section" id="contended" aria-labelledby="h-contended">${sectionHead("contended", "The most contended team", L ? L.rule : "", page, seen)}${body}</section>`;
}

// ---------- seams ----------

function crossingItem(c: SeamPageView["crossings"][number]): string {
  const sev = c.severity ?? (c.relevant ? "warning" : "");
  const ic = c.declared ? icon(c.relevant ? "k-claim" : "k-relationship", `icon icon-sm ${c.relevant ? "st-warning" : "muted"}`) : sevIcon(c.severity ?? "warning");
  return `<li class="pf-x${c.declared ? "" : ` undeclared ${c.severity ?? "warning"}`}${c.relevant ? " relevant" : ""}" data-ends="${attr(c.ends.join(" "))}">${ic}<div><p>${esc(c.text)}${c.carries.length ? ` <span class="chips pf-carries">${c.carries.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</span>` : ""}</p>
<p class="small fg2"><span class="tag ${c.relevant ? "warning" : ""}">${c.relevant ? "Security-relevant" : "Not security-relevant"}</span> ${esc(c.why.replace(/^(Security-relevant|Not security-relevant)(: )?/, ""))}${!c.declared && sev ? ` <span class="${c.severity === "error" ? "st fail sm" : "st warning sm"}"><span class="w">${c.severity === "error" ? "Error" : "Warning"}</span></span>` : ""}</p>
${c.excepted ? `<p class="small fg2">${esc(c.excepted)}</p>` : ""}</div></li>`;
}

function seamsSection(page: PortfolioPageFacts, seen: Set<string>): string {
  const cards = page.seams.map((s) => {
    const kindWord = s.key.startsWith("shared:") && s.kind === "shared" && s.name.endsWith("a shared part") ? "Shared part" : s.kind === "module" ? "Module seam" : "Seam between designs";
    const owner = s.ownerTeams.length ? `Owned by ${list(s.ownerTeams.map((t) => t.name))}${s.ownerRole ? ` (as ${s.ownerRole})` : ""}` : s.ownerRole ? `Owned by ${s.ownerRole}. The team map gives that role to no team` : "No owner named";
    return `<article class="pf-seam panel pad" data-seam="${attr(s.key)}" data-teams="${attr(s.ownerTeams.map((t) => t.id).join(" "))}">
<div class="pf-seam-head"><h3>${esc(s.name)}</h3><span class="tag">${esc(kindWord)}</span>${s.undeclared.length ? `<span class="tag ${s.undeclared.some((c) => c.severity === "error") ? "danger" : "warning"}">${esc(`${count(s.undeclared.length, "undeclared crossing")}`)}</span>` : ""}</div>
<p class="small fg2">${esc(sentence(`Between ${list(s.sides)}. ${owner}`))}${s.checks.length ? ` ${esc(sentence(`Checks that must hold across it: ${list(s.checks.map((x) => quote(x)))}`))}` : ""}${s.neverCross.length ? ` ${esc(sentence(`Must never cross: ${list(s.neverCross)}`))}` : ""}</p>
${s.undeclared.length ? `<h4>Nothing declares these</h4><ul class="pf-xs">${s.undeclared.map(crossingItem).join("")}</ul>` : ""}
${s.exceptions.length ? `<h4>Exceptions</h4><ul class="rows pf-exc">${s.exceptions.map((x) => `<li class="${x.state === "in force" ? "" : "muted"}"><span class="tag ${x.state === "in force" ? "accent" : ""}">${esc(x.state === "in force" ? "In force" : x.state === "ended" ? "Ended" : "Not applied")}</span><span>${esc(x.text)}${x.why ? ` <span class="fg2">${esc(x.why)}</span>` : ""}</span></li>`).join("")}</ul>` : ""}
${s.crossings.length ? `<details class="disc"${s.crossings.length <= 4 ? " open" : ""}><summary><h4>${esc(`Declared crossings (${s.crossings.length})`)}</h4></summary><div class="body"><ul class="pf-xs">${s.crossings.map(crossingItem).join("")}</ul></div></details>` : ""}
</article>`;
  }).join("\n");
  const extra = [
    page.stalePins.length ? `<div class="callout warning">${icon("warning")}<div><b>Stale pins.</b> ${page.stalePins.map((p) => esc(p.text)).join(" ")}</div></div>` : "",
    page.composedOnly.length ? `<div class="callout">${icon("info")}<div><b>Found only with the designs composed.</b><ul class="rows">${page.composedOnly.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul></div></div>` : "",
  ].filter(Boolean).join("");
  return `<section class="section" id="seams" aria-labelledby="h-seams">${sectionHead("seams", "Seams and crossings", "Every seam, its owner, what crosses it with its mark, the exceptions in force and what nothing declares. A design's own edges to a shared part sit under that part.", page, seen)}
${extra ? `<div class="pf-callouts">${extra}</div>` : ""}<div class="pf-seams">${cards}</div></section>`;
}

// ---------- slowdowns ----------

function slowdowns(data: PortfolioData, page: PortfolioPageFacts, seen: Set<string>): string {
  const bets = data.load?.slowdowns ?? [];
  const cards = bets.map((b) => {
    const st = b.state === "running" ? `<span class="tag accent">${icon("doing", "icon icon-sm")}Running</span>` : b.state === "not started" ? `<span class="tag">Not started</span>` : b.state === "ended" ? `<span class="tag">Ended</span>` : `<span class="tag danger">Not applied</span>`;
    return `<article class="pf-bet panel pad" data-team="${attr(b.team)}" data-slowdown="${attr(b.id)}"><div class="pf-seam-head"><h3>${esc(`Slowing ${b.activityName.charAt(0).toLowerCase()}${b.activityName.slice(1)}`)}</h3>${st}${b.risk.level ? `<span class="tag ${b.risk.level === "high" ? "danger" : b.risk.level === "medium" ? "warning" : ""}">${esc(`Risk ${b.risk.level}`)}</span>` : ""}</div>
<p class="reading">${esc(b.text)}</p>
${b.flags.length ? `<ul class="rows">${b.flags.map((f) => `<li class="warn-text">${icon("warning", "icon icon-sm")}${esc(f)}</li>`).join("")}</ul>` : ""}</article>`;
  }).join("\n");
  return `<section class="section" id="slowdowns" aria-labelledby="h-slowdowns">${sectionHead("slowdowns", "Slowdown bets", "Each deliberate slowdown: what it frees, the risk that rises meanwhile, who accepted it and when it is reviewed.", page, seen)}
${cards ? `<div class="pf-bets">${cards}</div>` : `<p class="empty">No slowdown is recorded.</p>`}</section>`;
}

// ---------- flow distribution ----------

function flow(data: PortfolioData, page: PortfolioPageFacts, seen: Set<string>): string {
  const D = data.load?.distribution;
  if (!D) return `<section class="section" id="flow" aria-labelledby="h-flow">${sectionHead("flow", "Flow distribution", "", page, seen)}<p class="empty">The root has no org layer, so there is no distribution to read.</p></section>`;
  const items = D.items;
  const ITEM = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const bar = (by: Record<string, number>, total: number) => total ? `<span class="fd-bar" aria-hidden="true">${items.map((x) => (by[x] ? `<span class="fd-${x}" style="width:${((by[x] / total) * 100).toFixed(1)}%"></span>` : "")).join("")}</span>` : "";
  const unitsRows = D.designs.map((d) => `<tr data-design="${attr(d.design)}"><td class="lead" data-label="">${esc(d.title)}</td>${items.map((x) => `<td class="n inline" data-label="${attr(ITEM(x))}">${fmt(d.by[x] ?? 0)}</td>`).join("")}<td class="inline" data-label="Defaults">${esc(d.defaults ? `${fmt(d.defaults)} of ${fmt(d.open)} still defaults` : d.set ? `${fmt(d.set)} set here` : "none")}</td><td class="hide-narrow">${bar(d.by, d.open)}</td></tr>`).join("");
  const teamRows = D.teams.map((t) => `<tr data-team="${attr(t.team)}"><td class="lead" data-label="">${esc(t.name)}</td>${items.map((x) => `<td class="n inline" data-label="${attr(ITEM(x))}">${t.by[x] ? esc(t.by[x].slots !== undefined ? num(t.by[x].slots!) : pct(t.by[x].share)) : "0"}</td>`).join("")}<td class="hide-narrow">${bar(Object.fromEntries(items.map((x) => [x, t.by[x]?.slots ?? t.by[x]?.share ?? 0])), items.reduce((n, x) => n + (t.by[x]?.slots ?? t.by[x]?.share ?? 0), 0))}</td></tr>`).join("");
  const key = `<ul class="lb-legend fd-key">${items.map((x) => `<li><span class="lb-key fd-${x}"></span>${esc(ITEM(x))}</li>`).join("")}</ul>`;
  return `<section class="section" id="flow" aria-labelledby="h-flow">${sectionHead("flow", "Flow distribution", "Open units by flow item and design, and the teams' standing activities beside them: one zero-sum view across feature, defect, risk and debt.", page, seen)}
<p class="reading">${esc(D.text)}</p>
<div class="grid-2"><div><h3 class="pf-h3">Open units</h3><div class="table-wrap reflow"><table class="reflow"><thead><tr><th scope="col">Design</th>${items.map((x) => `<th scope="col" class="n">${esc(ITEM(x))}</th>`).join("")}<th scope="col">Defaults</th><th scope="col" class="hide-narrow"><span class="sr-only">Split</span></th></tr></thead><tbody>${unitsRows}</tbody></table></div></div>
<div><h3 class="pf-h3">Standing activities, in slots</h3><div class="table-wrap reflow"><table class="reflow"><thead><tr><th scope="col">Team</th>${items.map((x) => `<th scope="col" class="n">${esc(ITEM(x))}</th>`).join("")}<th scope="col" class="hide-narrow"><span class="sr-only">Split</span></th></tr></thead><tbody>${teamRows}</tbody></table></div></div></div>
${key}</section>`;
}

// ---------- estimates ----------

/** A small step chart of an estimate over time: the value in force as steps, measured values as dots, a kept stated figure dashed. */
export function trendSvg(e: EstimateRow, today: string): string {
  const pts = e.trend;
  if (!pts.length) return `<span class="muted small">no history</span>`;
  const W = 120, H = 32, P = 3;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const xs = [...pts.map((p) => t(p.as_of)), t(today)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vmax = Math.max(...pts.map((p) => p.value), 0) || 1;
  const X = (d: string) => P + ((t(d) - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
  const Y = (v: number) => H - P - (v / vmax) * (H - 2 * P);
  const vals = pts.filter((p) => p.kind === "value");
  let d = "";
  vals.forEach((p, i) => { const x = X(p.as_of), y = Y(p.value); d += i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : ` H${x.toFixed(1)} V${y.toFixed(1)}`; });
  if (vals.length) d += ` H${X(today).toFixed(1)}`;
  const dots = pts.filter((p) => p.kind === "measured").map((p) => `<circle class="tr-m" cx="${X(p.as_of).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="2.4"/>`).join("");
  const stated = pts.filter((p) => p.kind === "stated").map((p) => `<path class="tr-s" d="M${X(p.as_of).toFixed(1)} ${Y(p.value).toFixed(1)} H${X(today).toFixed(1)}"/>`).join("");
  const fmtV = (v: number) => (e.unit === "slots" ? slots(v) : pct(v));
  const hover = [`${e.what}${e.teamName ? `, ${e.teamName}` : ""}: every point`, ...pts.map((p) => `${shortDay(p.as_of, today)} · ${fmtV(p.value)} · ${p.kind === "measured" ? `measured ${p.source}` : p.kind === "stated" ? `a person's figure kept beside the measure, ${p.source}` : `in force, ${p.source}`}`)].join("\n");
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${attr(`Trend: ${hover.replace(/\n/g, "; ")}`)}" data-hover="${attr(hover)}" tabindex="0"><path class="tr-v" d="${d}"/>${stated}${dots}</svg>`;
}

function estimates(page: PortfolioPageFacts, seen: Set<string>): string {
  const teams = [...new Map(page.estimates.filter((e) => e.team).map((e) => [e.team!, e.teamName ?? e.team!])).entries()];
  const rows = page.estimates.map((e) => `<tr data-team="${attr(e.team ?? "")}" data-record="${attr(`${e.record} ${e.field}`)}">
<td class="lead" data-label="">${esc(e.teamName ?? "")}<span class="small fg2 pv-what-cell">${esc(e.what)}</span></td>
<td class="inline num" data-label="Value"><b>${esc(e.valueText)}</b>${e.stale ? ` <span class="tag warning">${icon("warning", "icon icon-sm")}Stale</span>` : ""}</td>
<td data-label="Provenance">${esc(e.provenance)}${e.rowOwner && !e.rowOwner.statedByOwner ? `<span class="small muted pv-owner">${esc(`Not stated by the row's owner, ${e.rowOwner.owner}`)}</span>` : ""}</td>
<td data-label="Trend">${trendSvg(e, page.today)}</td>
<td data-label="Measured">${e.measured ? esc(e.measured.text) : `<span class="muted">none</span>`}${e.gap ? `<span class="small ${e.gap.over ? "warn-text" : "fg2"} pv-gap">${e.gap.over ? icon("warning", "icon icon-sm") : ""}${esc(e.gap.text)}</span>` : ""}${e.payoff ? `<span class="small ${e.payoff.landed ? "fg2" : "warn-text"} pv-gap">${esc(e.payoff.text)}</span>` : ""}</td>
<td data-label="Proposed">${e.pending.length ? e.pending.map((p) => `<span class="small pending">${esc(p.text)}</span>`).join("") : `<span class="muted">none</span>`}</td></tr>`).join("");
  return `<section class="section" id="estimates" aria-labelledby="h-estimates">${sectionHead("estimates", "Estimates", "Every number about the organization: its value, who stated or measured it and when, how sure, its trend, the measured value and any gap, and a change proposed to it.", page, seen)}
<div class="filters" id="est-filter" hidden><label class="field">Team<select id="est-team"><option value="">Every team</option>${teams.map(([id, n]) => `<option value="${attr(id)}">${esc(n)}</option>`).join("")}</select></label><p class="small fg2" id="est-count" aria-live="polite"></p></div>
<div class="table-wrap reflow"><table class="reflow pf-est"><thead><tr><th scope="col">Team and number</th><th scope="col">Value</th><th scope="col">Provenance</th><th scope="col">Trend</th><th scope="col">Measured</th><th scope="col">Proposed</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small muted">The trend: the value in force as steps, each measure as a dot, a stated figure kept beside a measure as a dashed line. Hover or focus a trend for every point and its source.</p></section>`;
}

// ---------- changes ----------

function changes(page: PortfolioPageFacts, seen: Set<string>): string {
  const VERDICT: Record<string, [string, string]> = { fail: ["fail", "Breaks a check"], caution: ["warning", "Review before accepting"], pass: ["pass", "Passes every check"] };
  const item = (p: PortfolioPageFacts["patches"][number]) => {
    const v = p.verdict ? VERDICT[p.verdict.level] : undefined;
    const who = p.agent ? `Proposed by the agent ${p.by}` : `Written by ${p.by}`;
    return `<article class="pf-patch panel pad" data-patch="${attr(p.id)}"><div class="pf-seam-head"><h3>${esc(p.title)}</h3><span class="tag ${p.status === "accepted" ? "success" : p.status === "proposed" ? "accent" : ""}">${esc(p.status.charAt(0).toUpperCase() + p.status.slice(1))}</span>${v ? `<span class="st ${v[0]} sm">${icon(v[0])}<span class="w">${esc(v[1])}</span></span>` : ""}</div>
<p class="small fg2">${esc(`${who}${p.created ? ` on ${shortDay(p.created, page.today)}` : ""}.`)}${p.decision ? ` ${esc(sentence(`${p.status === "rejected" ? "Rejected" : "Accepted"} by ${p.decision.by} on ${shortDay(p.decision.at, page.today)}${p.decision.reason ? `: ${p.decision.reason.replace(/[.\s]+$/, "")}` : ""}`))}` : ""}</p>
${p.effect ? `<p class="reading">${esc(p.effect)}</p>` : ""}
${p.verdict?.reasons.length ? `<ul class="rows">${p.verdict.reasons.map((r) => `<li>${icon(p.verdict!.level === "fail" ? "fail" : "warning", `icon icon-sm st-${p.verdict!.level === "fail" ? "fail" : "warning"}`)}${esc(r)}</li>`).join("")}</ul>` : ""}
${p.why ? `<p class="small fg2">${esc(sentence(`Why: ${p.why.replace(/[.\s]+$/, "")}`))}</p>` : ""}
<details class="disc"><summary>${esc(`What it changes (${count(p.ops.length, "change")})`)}</summary><div class="body"><ul class="rows small">${p.ops.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></div></details></article>`;
  };
  const proposed = page.patches.filter((p) => p.status === "proposed"), rest = page.patches.filter((p) => p.status !== "proposed");
  return `<section class="section" id="changes" aria-labelledby="h-changes">${sectionHead("changes", "Changes to the root", "Proposed changes to the shared layer and the org layer first, each with its verdict on the whole portfolio, then the accepted ones.", page, seen)}
${proposed.length ? `<div class="pf-patches">${proposed.map(item).join("")}</div>` : `<p class="empty">No change to the root is proposed.</p>`}
${rest.length ? `<h3 class="pf-h3">Accepted and rejected</h3><div class="pf-patches">${rest.map(item).join("")}</div>` : ""}
${page.notes.length ? `<h3 class="pf-h3 pf-mw-h">Notes and questions on the root</h3><ul class="rows pf-notes">${page.notes.map((n) => `<li><span class="tag ${n.kind === "question" && n.status === "open" ? "accent" : ""}">${esc(`${n.kind === "question" ? "Question" : "Note"}, ${n.status}`)}</span><span><b>${esc(n.targetName)}:</b> ${esc(n.text)}${n.answer ? ` <span class="fg2">${esc(`Answer: ${n.answer}`)}</span>` : ""} <span class="small muted">${esc(`${n.author === "agent" ? "Written by an agent" : "Written by a person"}, ${shortDay(n.created, page.today)}`)}</span></span></li>`).join("")}</ul><p class="small muted">The root's notes live in its notes.yaml; this page shows them read-only.</p>` : ""}</section>`;
}

// ---------- checks ----------

function checks(page: PortfolioPageFacts, seen: Set<string>): string {
  const byRule = new Map<string, PortfolioPageFacts["findings"]>();
  for (const f of page.findings) byRule.set(`${f.pack}/${f.rule}`, [...(byRule.get(`${f.pack}/${f.rule}`) ?? []), f]);
  const errors = page.findings.filter((f) => f.severity === "error").length, warnings = page.findings.length - errors;
  const blocks = [...byRule.entries()].sort((a, b) => Number(b[1].some((f) => f.severity === "error")) - Number(a[1].some((f) => f.severity === "error")) || b[1].length - a[1].length).map(([k, fs]) => {
    const r = page.rules.find((x) => x.key === k);
    const sev = fs.some((f) => f.severity === "error") ? "error" : "warning";
    return `<details class="rule failing ${sev}" data-rule="${attr(k)}" open><summary>${sevIcon(sev)}<span class="rt">${esc(r?.title ?? k)}</span><span class="rmeta"><span class="tag">${r?.severity === "error" ? "Error rule" : "Warning rule"}</span><span class="badge ${sev === "error" ? "danger" : "warning"}">${fs.length}<span class="sr-only"> ${fs.length === 1 ? "finding" : "findings"}</span></span><span class="chev" aria-hidden="true"></span></span></summary>
<div class="rbody">${r?.why ? `<p class="why">${esc(r.why)}</p>` : ""}<ul class="subjects long">${fs.map((f) => `<li data-finding="${attr(f.key)}" data-sev="${f.severity}">${f.severity !== sev ? sevIcon(f.severity) + " " : ""}<b>${esc(f.subjectName)}</b>${f.design ? ` <span class="small muted">${esc(`in ${page.designs.find((d) => d.namespace === f.design)?.title ?? f.design}`)}</span>` : ""} <span class="diff">${esc(f.text)}</span>${f.composedOnly ? ` <span class="tag">Found only with the designs composed</span>` : ""}${f.excepted ? ` <span class="tag accent">${esc(`Made a warning by ${f.excepted}`)}</span>` : ""}</li>`).join("")}</ul>
<details class="how"><summary>How this is checked</summary><p class="small fg2">Rule <code>${esc(k)}</code>. Run <code>bun plumb.ts portfolio check</code> to list its findings with their ids.</p></details></div></details>`;
  }).join("\n");
  return `<section class="section" id="checks" aria-labelledby="h-checks">${sectionHead("checks", "Checks across the portfolio", "Every finding once: the designs' own, the composed checks' and the portfolio's, failing rules first.", page, seen)}
<div class="summary-bar">${errors ? `<span class="st fail">${icon("fail")}<span class="w">Fails ${errors}</span></span>` : `<span class="st pass">${icon("pass")}<span class="w">Passes</span></span>`}<span class="fg2">${esc(warnings ? count(warnings, "warning") : "No warnings")}</span></div>
${blocks || `<p class="empty">Every check passes.</p>`}</section>`;
}

// ---------- the page ----------

/** What the client reads: the focus and its facts, the page's name. */
export function clientData(data: PortfolioData): unknown {
  const p = data.page!;
  return { v: 1, name: data.portfolio.name, title: data.portfolio.title, mode: data.portfolio.mode, focus: p.focus };
}

/** Render the portfolio page. Pure: the same portfolio.json in, the same page out. */
export function renderPortfolio(data: PortfolioData): string {
  const page = data.page;
  if (!page) throw new Error("renderPortfolio needs portfolio.json's page facts: build it with bun plumb.ts portfolio build");
  const seen = new Set<string>();
  const presenting = data.portfolio.mode === "presenting";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${attr(`Portfolio page for ${data.portfolio.title}: ${page.mode.head.toLowerCase()}`)}">
<meta name="generator" content="Plumb ${attr(data.engine.version)}">
<title>${esc(`${data.portfolio.title}${presenting ? " (presenting)" : ""}`)}</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}${PORTFOLIO_CSS}</style>
</head>
<body class="pf">
<a class="skip" href="#main">Skip to content</a>
${SPRITE()}
${header(data)}
${nav()}
${modeBar(page)}
<main id="main" tabindex="-1">
<section class="page pf-page" id="portfolio" aria-labelledby="h-portfolio">
<div class="page-head"><h1 id="h-portfolio" tabindex="-1">${esc(data.portfolio.title)}</h1><p class="muted">${esc(`Portfolio of ${count(data.designs.length, "design")}`)}</p></div>
<p class="brief" id="pf-sentence">${esc(page.sentence)}</p>
<p class="pf-modeline small fg2">${esc(page.mode.line)}</p>
<div id="pf-focus-note" class="callout info pf-focus-note" hidden></div>
${designs(data, page, seen)}
${roadmap(page, seen)}
${load(data, page, seen)}
${contended(data, page, seen)}
${seamsSection(page, seen)}
${slowdowns(data, page, seen)}
${flow(data, page, seen)}
${estimates(page, seen)}
${changes(page, seen)}
${checks(page, seen)}
<p class="small muted pf-foot">${esc(`Built ${shortDay(page.today, page.today)} by Plumb ${data.engine.version} from ${data.portfolio.file}. Every number here is in portfolio.json beside this page.`)}</p>
</section>
</main>
<div id="pf-hover" class="hovercard pf-hover" role="tooltip" hidden></div>
<div id="live" class="sr-only" aria-live="polite" aria-atomic="true"></div>
<script type="application/json" id="de-portfolio">${inlineJson(clientData(data))}</script>
<script>${inlineScript(PORTFOLIO_JS)}</script>
</body>
</html>
`;
}

export default renderPortfolio;
export { possessive };
