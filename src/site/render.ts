// Site generator: Bundle -> one self-contained HTML document.
//
// Every page opens with a computed sentence, then the working list, then the detail.
// The static markup carries each page's answer and its lists, so the page reads without JavaScript and
// every deep-link target exists in the markup. The inline client (src/site/client/*.js) adds routing, global
// selection, the diagrams (curated views, neighbourhood, summary, before and after), the inspectors, the command
// palette, the tour and the keyboard model. Every number printed here is one the bundle holds.
import type { Bundle, Finding, Impact, MilestoneStatus, PathAction, Patch, RecordKind, RecordSnapshot, Unit } from "../types";
import { CSS, PORTFOLIO_CSS } from "./styles";
import { esc, domId, natural, plural, inlineJson, inlineScript } from "./html";
import { count, fmt, list, quote, sentence, para, verb } from "./prose";
import { capabilityName, claimShort } from "../core/reader";
import { trackerPage, trackerCounts } from "./tracker";
import { comparisonsSection, GRADE_SYMBOLS, loadBearing, notesPage, strategyPage } from "./strategy";
import CLIENT_PROSE from "./client/prose.js" with { type: "text" };
import CLIENT_FLOW from "./client/flow.js" with { type: "text" };
import { FLOWUI } from "./flow.ts";
import CLIENT_DIGEST from "./client/digest.js" with { type: "text" };
import CLIENT_STRATEGY from "./client/strategy.js" with { type: "text" };
import CLIENT_CORE from "./client/core.js" with { type: "text" };
import CLIENT_GRAMMAR from "./client/grammar.js" with { type: "text" };
import CLIENT_UI from "./client/ui.js" with { type: "text" };
import CLIENT_OVERVIEW from "./client/overview.js" with { type: "text" };
import CLIENT_GRAPH from "./client/graph.js" with { type: "text" };
import CLIENT_VIEWS from "./client/views.js" with { type: "text" };
import CLIENT_APP from "./client/app.js" with { type: "text" };
import CLIENT_PRESENT from "./client/present.js" with { type: "text" };
import CLIENT_TEAMS from "./client/teams.js" with { type: "text" };
import CLIENT_LEARN from "./client/learn.js" with { type: "text" };
import CLIENT_GLOSSARY from "./client/glossary.js" with { type: "text" };
import CLIENT_BLOCKERS from "./client/blockers.js" with { type: "text" };
import CLIENT_FOCUS from "./client/focus.js" with { type: "text" };
import { presentSection } from "./present";
import { teamsPage } from "./teams";
import { teamList } from "../core/teams";
const deciderOf = (e: { attrs?: Record<string, unknown> }) => teamList(e.attrs?.decider);
import { RAG_ICON as RAG_ICON_NAME, RAG_SYMBOLS, RAG_WORD, historyStrip, ragHtml, statusBlock, statusOf } from "./status";
import { dayText, trackerSays } from "../core/status";

/** The client script: one IIFE that defines DE, then boots when the page holds a bundle. */
export const CLIENT_JS = `var DE = (function () {\n"use strict";\nvar api = {};\n${CLIENT_PROSE}\napi.prose = PROSE;\n${CLIENT_FLOW}\napi.flow = FLOWUI;\n${CLIENT_DIGEST}\napi.digest = DIGEST;\n${CLIENT_CORE}\n${CLIENT_BLOCKERS}\n${CLIENT_GRAMMAR}\n${CLIENT_GRAPH}\n${CLIENT_VIEWS}\n${CLIENT_STRATEGY}\n${CLIENT_PRESENT}\n${CLIENT_TEAMS}\n${CLIENT_LEARN}\n${CLIENT_GLOSSARY}\n${CLIENT_FOCUS}\n${CLIENT_UI}\n${CLIENT_OVERVIEW}\n${CLIENT_APP}\nreturn api;\n})();
if (typeof document !== "undefined" && document.getElementById && document.getElementById("de-bundle")) {
  try { DE.boot(); } catch (e) { if (typeof console !== "undefined") console.error("Plumb: the page script failed", e); }
}
`;

export const PAGES = [
  { id: "overview", label: "Overview" },
  { id: "model", label: "Model" },
  { id: "plan", label: "Plan" },
  { id: "checks", label: "Checks" },
  { id: "changes", label: "Changes" },
] as const;
/** Kept for callers of the earlier site: the page list. */
export const TABS = PAGES;

const PATCH_LABEL: Record<string, string> = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" };
const NOUN: Record<string, [string, string]> = {
  element: ["part", "parts"], unit: ["unit", "units"], relationship: ["relationship", "relationships"], contract: ["contract", "contracts"],
  phase: ["milestone", "milestones"], view: ["view", "views"], team: ["team", "teams"], system: ["system", "systems"], zone: ["zone", "zones"], instance: ["place", "places"],
};
const KIND_LABEL: Record<string, string> = {
  element: "Element", relationship: "Relationship", contract: "Contract", team: "Team", system: "System",
  zone: "Zone", unit: "Unit", phase: "Milestone", view: "View", instance: "Instance",
};

// ---------- routes ----------
const enc = encodeURIComponent;
export const route = {
  element: (id: string) => `#model/element/${enc(id)}`,
  focus: (id: string) => `#model/focus/${enc(id)}`,
  view: (id: string) => `#model/view/${enc(id)}`,
  unit: (id: string) => `#plan/unit/${enc(id)}`,
  gate: (id: string) => `#plan/milestone/${enc(id)}`,
  milestone: (id: string) => `#plan/milestone/${enc(id)}`,
  rule: (pack: string, rule: string) => `#checks/rule/${enc(pack)}/${enc(rule)}`,
  patch: (id: string) => `#changes/${enc(id)}`,
  tracker: (step: string) => `#tracker/${step}`,
};

/** The tab icon, inline: the page asks no server for /favicon.ico (which the dev server and static hosts answer 404). */
export const FAVICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1.5" y="1.5" width="9" height="9" rx="2.2" fill="none" stroke="#2756C7" stroke-width="1.6"/><rect x="5.5" y="5.5" width="9" height="9" rx="2.2" fill="none" stroke="#2756C7" stroke-width="1.6"/><rect x="9.5" y="9.5" width="9" height="9" rx="2.2" fill="#2756C7"/></svg>`);

// ---------- icons (one sprite, referenced by <use>) ----------
/** One icon per record kind (the card's icon), plus filter, follow and back. Stroked in currentColor. */
const kindSym = (id: string, body: string) => `<symbol id="i-${id}" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></symbol>`;
export const KIND_SYMBOLS = [
  kindSym("k-element", `<rect x="2" y="3.5" width="12" height="9" rx="2"/>`),
  kindSym("k-relationship", `<path d="M2 8h10M9 5l3 3-3 3"/>`),
  kindSym("k-contract", `<path d="M4 1.75h5.5L12 4.25v10H4z"/><path d="M6 7.5h4M6 10h4"/>`),
  kindSym("k-team", `<circle cx="6" cy="6" r="2.25"/><circle cx="11" cy="6.5" r="1.75"/><path d="M2.5 13c.5-2.2 2-3.3 3.5-3.3S9 10.8 9.5 13M9.8 10.1c1.6-.3 3 .6 3.6 2.6"/>`),
  kindSym("k-unit", `<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 8.2l1.7 1.7 3.4-3.6"/>`),
  kindSym("k-phase", `<path d="M4 14V2.5M4 3h7.5l-1.8 2.6 1.8 2.6H4"/>`),
  kindSym("k-claim", `<path d="M8 2l5.5 6L8 14 2.5 8z"/>`),
  kindSym("k-finding", `<path d="M8 2.2l6 10.8H2z"/><path d="M8 6.5v3"/>`),
  kindSym("k-patch", `<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 6h5M8 3.5v5M5.5 11h5"/>`),
  kindSym("k-note", `<path d="M3 2.5h10v8l-3 3H3z"/><path d="M10 13.5v-3h3"/>`),
  kindSym("k-view", `<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M4.5 10l2.5-3 2.5 2 2-2.5"/>`),
  kindSym("k-zone", `<rect x="2" y="2" width="12" height="12" rx="2" stroke-dasharray="2.5 2"/>`),
  kindSym("filter", `<path d="M2.5 3h11l-4.25 5v4.5l-2.5 1.25V8z"/>`),
  kindSym("follow", `<path d="M4.5 8h7.5M9 4.5L12.5 8 9 11.5"/><circle cx="3" cy="8" r="1"/>`),
  kindSym("back", `<path d="M10 3.5L5.5 8l4.5 4.5"/>`),
  kindSym("focus", `<circle cx="8" cy="8" r="5.25"/><circle cx="8" cy="8" r="1.75"/><path d="M8 1v1.75M8 13.25V15M1 8h1.75M13.25 8H15"/>`),
].join("\n");
export const SPRITE = () => `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<symbol id="i-done" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" stroke="var(--bg-surface)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-pass" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" stroke="var(--bg-surface)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-doing" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-ready" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-blocked" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.75 8h6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="i-noprov" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>
<symbol id="i-fail" viewBox="0 0 16 16"><path d="M5.1 1h5.8L15 5.1v5.8L10.9 15H5.1L1 10.9V5.1z" fill="currentColor" stroke="none"/><path d="M8 4.5v4.2" stroke="var(--bg-surface)" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1.1" fill="var(--bg-surface)" stroke="none"/></symbol>
<symbol id="i-warning" viewBox="0 0 16 16"><path d="M8 1.5l7 12.5H1z" fill="currentColor" stroke="none" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="var(--bg-surface)" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1" fill="var(--bg-surface)" stroke="none"/></symbol>
<symbol id="i-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-agent" viewBox="0 0 16 16"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
<symbol id="i-present" viewBox="0 0 16 16"><rect x="1.75" y="2.25" width="12.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 10.75v3M5.25 13.75h5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
<symbol id="i-play" viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor" stroke="none" stroke-linejoin="round"/></symbol>
<symbol id="i-theme" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-close" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>
<symbol id="i-menu" viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
${KIND_SYMBOLS}
${GRADE_SYMBOLS}
${RAG_SYMBOLS}
<symbol id="i-mark" viewBox="0 0 20 20"><rect x="1.5" y="1.5" width="9" height="9" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="5.5" y="5.5" width="9" height="9" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9.5" y="9.5" width="9" height="9" rx="2.2" fill="currentColor" stroke="none" opacity="0.85"/></symbol>
</defs></svg>`;

const icon = (name: string, cls = "icon") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
/** Status: an icon and a word, always together (colour only reinforces). */
export function status(kind: string, word: string, size = ""): string {
  return `<span class="st ${esc(kind)}${size ? " " + size : ""}">${icon(kind)}<span class="w">${esc(word)}</span></span>`;
}
const UNIT_WORD: Record<string, string> = { done: "Done", doing: "In progress", ready: "Ready", blocked: "Blocked", noprov: "Needs work (unplanned)" };

// ---------- index ----------
export interface Ix {
  b: Bundle;
  el: Map<string, Bundle["model"]["elements"][number]>;
  rel: Map<string, Bundle["model"]["relationships"][number]>;
  unit: Map<string, Unit>;
  team: Map<string, string>;
  zone: Map<string, string>;
  system: Map<string, string>;
  phase: Map<string, Bundle["plan"]["phases"][number]>;
  phaseOrder: Bundle["plan"]["phases"];
  view: Map<string, Bundle["model"]["views"][number]>;
  frontier: Set<string>;
  providers: Map<string, string[]>;
  ruleTitle: Map<string, { title: string; why: string; severity: string; how?: string }>;
  issueOf: Map<string, string>;
}

export function index(b: Bundle): Ix {
  const providers = new Map<string, string[]>();
  const unit = new Map<string, Unit>();
  for (const u of b.plan.units) if (!unit.has(u.id)) unit.set(u.id, u); // the first of a duplicated id wins, as in the analysis
  for (const u of unit.values()) for (const c of u.provides ?? []) providers.set(c, [...(providers.get(c) ?? []), u.id]);
  const ruleTitle = new Map<string, { title: string; why: string; severity: string; how?: string }>();
  for (const p of b.instance.packs) for (const r of p.rules) ruleTitle.set(`${p.name}/${r.id}`, r);
  const issueOf = new Map<string, string>();
  for (const [u, s] of Object.entries(b.tracker?.reconcile?.state ?? {})) issueOf.set(u, s.issue);
  return {
    b,
    el: new Map(b.model.elements.map((e) => [e.id, e])),
    rel: new Map(b.model.relationships.map((r) => [r.id, r])),
    unit,
    team: new Map(b.model.teams.map((t) => [t.id, t.name])),
    zone: new Map(b.model.zones.map((t) => [t.id, t.name])),
    system: new Map(b.model.systems.map((t) => [t.id, t.name])),
    phase: new Map(b.plan.phases.map((p) => [p.id, p])),
    phaseOrder: [...b.plan.phases].sort((a, c) => (a.order ?? 0) - (c.order ?? 0) || natural(a.id, c.id)),
    view: new Map(b.model.views.map((v) => [v.id, v])),
    frontier: new Set(b.analysis?.frontier ?? []),
    providers,
    ruleTitle,
    issueOf,
  };
}

/** Who provides a capability across a seam (a 0.4 design), in words, or "" (analysis.outside, src/core/plan.ts). */
const across = (ix: Ix, c: string): string => { const p = ix.b.analysis?.outside?.[c]; return p ? `${list(p.map((n) => ix.b.instance.homes?.[n] ?? n))}, outside this design` : ""; };

/** A unit's state: done, in progress, ready (can start now), blocked, or blocked with no unit providing what it needs. */
export function unitState(ix: Ix, u: Unit): "done" | "doing" | "ready" | "blocked" | "noprov" {
  const st = u.status ?? "todo";
  if (st === "done") return "done";
  if (st === "doing") return "doing";
  if (ix.frontier.has(u.id)) return "ready";
  const bl = ix.b.analysis?.blocked?.[u.id];
  if (bl) {
    if (bl.missing.some((c) => !(ix.providers.get(c) ?? []).some((p) => p !== u.id) && !across(ix, c))) return "noprov";
    return "blocked";
  }
  const missing = (u.requires ?? []).filter((c) => !(ix.providers.get(c) ?? []).some((p) => ix.unit.get(p)?.status === "done"));
  return missing.some((c) => !(ix.providers.get(c) ?? []).length && !across(ix, c)) ? "noprov" : "blocked";
}

/** A unit's owner teams: inherited from its parts (bundle.teams), else its own owner field. */
export function ownersOf(ix: Ix, u: Unit): string[] {
  return ix.b.teams?.units[u.id]?.owners ?? (u.owner ? [u.owner] : []);
}

export function phaseStats(b: Bundle, id: string) {
  const a = b.analysis?.phases?.find((p) => p.id === id);
  if (a) return a;
  const us = b.plan.units.filter((u) => u.phase === id);
  const done = us.filter((u) => u.status === "done").length;
  return { id, total: us.length, done, complete: done === us.length };
}

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

/** The current milestone: the lowest-order one that is not reached. */
export function currentGate(ix: Ix) {
  const i = ix.phaseOrder.findIndex((p) => !phaseStats(ix.b, p.id).complete);
  return i < 0 ? undefined : { phase: ix.phaseOrder[i], n: i + 1 };
}

/** "Can start now", ranked by transitive unblocks, then direct, then natural id (the order the MCP server uses). */
export function rankedFrontier(ix: Ix): { id: string; total: number; direct: number }[] {
  const a = ix.b.analysis;
  const open = new Set([...ix.unit.values()].filter((u) => u.status !== "done").map((u) => u.id));
  const direct = (id: string) => (a?.unblocks?.[id] ?? []).filter((x) => open.has(x) && x !== id).length;
  const total = (id: string) => {
    if (a?.unblocksTransitive && a.unblocksTransitive[id] !== undefined) return a.unblocksTransitive[id];
    const seen = new Set<string>([id]), stack = [id];
    while (stack.length) for (const n of a?.unblocks?.[stack.pop()!] ?? []) if (open.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    return seen.size - 1;
  };
  return (a?.frontier ?? []).filter((id) => ix.unit.has(id)).map((id) => ({ id, total: total(id), direct: direct(id) }))
    .sort((x, y) => y.total - x.total || y.direct - x.direct || natural(x.id, y.id));
}

/** Ready work and work already moving, apart: the frontier split by whether it has started. */
export function readySplit(ix: Ix): { ready: number; moving: number } {
  const f = (ix.b.analysis?.frontier ?? []).filter((id) => ix.unit.has(id));
  const moving = f.filter((id) => ix.unit.get(id)!.status === "doing").length;
  return { ready: f.length - moving, moving };
}
/** What finishing a unit does: the open units it readies (it is the last open work they wait on) and those it moves closer. */
export function readiesOf(ix: Ix, id: string): { readies: string[]; closer: number } {
  const a = ix.b.analysis;
  const open = (x: string) => ix.unit.get(x)?.status !== "done";
  const readies = (a?.unblocks?.[id] ?? []).filter((d) => d !== id && open(d) && (a?.deps?.[d] ?? []).every((x) => x === id || !open(x))
    && !(a?.blocked?.[d]?.missing ?? []).some((c) => !(ix.providers.get(c) ?? []).length));
  const total = a?.unblocksTransitive?.[id] ?? 0;
  return { readies, closer: Math.max(0, total - readies.length) };
}

const gateClass = (ix: Ix, phaseId: string) => { const i = ix.phaseOrder.findIndex((p) => p.id === phaseId); return `g${i < 0 ? 5 : Math.min(i + 1, 5)}`; };
/** A milestone by its name, never its number. */
const gateLabel = (ix: Ix, phaseId: string) => ix.phase.get(phaseId)?.name || phaseId;

// ---------- references ----------
function unitLink(ix: Ix, id: string, withTitle = true): string {
  const u = ix.unit.get(id);
  if (!u) return `<span class="muted" title="Not in the plan">${esc(id)}</span>`;
  const s = unitState(ix, u);
  // with its title the id is only the tooltip (and the hover card); a compact chip without one shows the id
  return withTitle
    ? `<a href="${route.unit(id)}" class="unit-ref" data-unit="${esc(id)}" title="${esc(id)}">${icon(s, "icon icon-sm st-" + s)}<span class="sr-only">${UNIT_WORD[s]}: </span>${esc(u.title)}</a>`
    : `<a href="${route.unit(id)}" class="unit-ref" data-unit="${esc(id)}" title="${esc(u.title)}">${icon(s, "icon icon-sm st-" + s)}<span class="sr-only">${UNIT_WORD[s]}: </span><span class="id">${esc(id)}</span></a>`;
}

function elementLink(ix: Ix, id: string, snap?: RecordSnapshot): string {
  const e = ix.el.get(id);
  if (e) return `<a href="${route.element(id)}" data-element="${esc(id)}">${esc(e.name)}</a>`;
  return `<span title="Not in the compiled model">${esc(snap?.name ?? id)}</span>`;
}

/** A record named from the compiled model, else from the patch's own snapshot (a record the patch adds or removes). */
function recordRef(ix: Ix, kind: RecordKind | "instance", id: string, snap?: RecordSnapshot): string {
  switch (kind) {
    case "element": return elementLink(ix, id, snap);
    case "unit": return ix.unit.has(id) ? unitLink(ix, id) : `<span title="${esc(id)}">${esc(snap?.name ?? id)}</span>`;
    case "claim": { const c = ix.b.model.claims?.find((x) => x.id === id); return c ? `<a href="#strategy/claim/${encodeURIComponent(id)}" data-claim="${esc(id)}" title="${esc(id)}">${esc(quote(claimShort(c.statement)))}</a>` : `<span title="${esc(id)}">${esc(snap?.name ?? "a claim no longer in the model")}</span>`; }
    case "relationship": {
      const r = ix.rel.get(id);
      const from = r?.from ?? snap?.from, to = r?.to ?? snap?.to;
      if (!from || !to) return `<span title="${esc(id)}">${esc(snap?.name ?? "a relationship no longer in the model")}</span>`;
      const label = r?.label ?? snap?.label;
      const kindWord = r?.kind ?? snap?.relKind;
      return `${elementLink(ix, from)} <span role="img" aria-label="to">&#8594;</span> ${elementLink(ix, to)}${label || kindWord ? ` <span class="muted small" title="${esc(id)}">${esc([kindWord, label].filter(Boolean).join(": "))}</span>` : ""}`;
    }
    case "phase": { const p = ix.phase.get(id); return p ? `<a href="${route.gate(id)}">${esc(gateLabel(ix, id))}</a>` : `<span>${esc(snap?.name ?? id)}</span>`; }
    case "view": { const v = ix.view.get(id); return v ? `<a href="${route.view(id)}">${esc(v.title)}</a>` : `<span>${esc(snap?.name ?? id)}</span>`; }
    case "team": return esc(ix.team.get(id) ?? snap?.name ?? id);
    case "zone": return esc(ix.zone.get(id) ?? snap?.name ?? id);
    case "system": return esc(ix.system.get(id) ?? snap?.name ?? id);
    case "contract": return `<span class="chip">${esc(id)}</span>`;
    default: return `<span class="muted">${esc(id || "the instance")}</span>`;
  }
}

/** The part of each finding's message that differs from the rule's other findings, with the subject's own id and name removed. */
export function messageDiffs(fs: Finding[], nameOf: (f: Finding) => string | undefined): string[] {
  const msg = (f: Finding) => f.text ?? f.message; // the reader's text: names where the message has ids
  if (fs.length < 2) return fs.map(msg);
  const words = fs.map((f) => msg(f).split(/\s+/));
  let pre = 0;
  while (words.every((w) => pre < w.length && w[pre] === words[0][pre])) pre++;
  let suf = 0;
  while (words.every((w) => suf < w.length - pre && w[w.length - 1 - suf] === words[0][words[0].length - 1 - suf])) suf++;
  // a shared last word such as "team)" must not take a parenthesis away from the part that differs: give words back
  // to the middle until every middle's parentheses balance
  const open = (xs: string[]) => xs.join(" ").split("(").length - xs.join(" ").split(")").length;
  const unbalanced = () => words.some((w) => open(w.slice(pre, w.length - suf)) !== 0);
  while (suf > 0 && unbalanced()) suf--;
  while (pre > 0 && unbalanced()) pre--;
  return fs.map((f, i) => {
    let mid = words[i].slice(pre, words[i].length - suf).join(" ");
    const name = nameOf(f);
    if (name) mid = mid.split(`(${name})`).join(" ").split(quote(name)).join(" ");
    // drop the subject's own id and name as whole words only, never as letters inside other words
    mid = mid.split(" ").filter((w) => w !== f.at && w !== name).join(" ");
    if (name && mid.trim() === name) mid = "";
    return mid.replace(/\(\s*\)/g, "").replace(/\s+/g, " ").replace(/^[\s,:;·-]+|[\s,:;·-]+$/g, "").trim();
  });
}

function subjectName(ix: Ix, f: Finding): string | undefined {
  if (f.atKind === "element") return ix.el.get(f.at)?.name;
  if (f.atKind === "unit") return ix.unit.get(f.at)?.title;
  if (f.atKind === "phase") return ix.phase.get(f.at)?.name;
  if (f.atKind === "view") return ix.view.get(f.at)?.title;
  if (f.atKind === "team") return ix.team.get(f.at);
  if (f.atKind === "claim") { const c = ix.b.model.claims?.find((x) => x.id === f.at); return c ? claimShort(c.statement) : undefined; }
  if (f.atKind === "relationship") { const r = ix.rel.get(f.at); return r ? `${ix.el.get(r.from)?.name ?? r.from} → ${ix.el.get(r.to)?.name ?? r.to}` : undefined; }
  return undefined;
}

function subjectLink(ix: Ix, f: Finding): string {
  if (f.atKind === "unit" && ix.unit.has(f.at)) return `<a href="${route.unit(f.at)}" data-unit="${esc(f.at)}" title="${esc(f.at)}">${esc(ix.unit.get(f.at)!.title)}</a>`;
  return recordRef(ix, f.atKind, f.at);
}

// ---------- header and nav ----------
function header(ix: Ix): string {
  const b = ix.b;
  // every instance has a tour: "Learn the interface" is generic; "Story of this design" is tour.yaml, when there is one
  const tour = `<span class="menu-wrap"><button type="button" class="btn tour-btn" id="tour-btn" aria-haspopup="true" hidden>${icon("play")}<span class="lbl">Tour</span></button></span>`;
  const present = b.deck?.slides?.length ? `<a class="btn present-btn" id="present-btn" href="#present" title="Present (P)">${icon("present")}<span class="lbl">Present</span></a>` : "";
  return `<header class="app-header"><div class="inner">
<span class="mark">${icon("mark", "")}<span class="words">Plumb</span></span>
<span class="app-title" title="${esc(b.instance.title)}">${esc(b.instance.title)}</span>
<div class="hdr-actions">
<button type="button" class="btn search-btn" id="search-btn" aria-haspopup="dialog" aria-label="Search and jump" hidden>${icon("search")}<span class="lbl">Search</span><span class="kbd" aria-hidden="true">&#8984;K</span></button>
<span class="menu-wrap"><button type="button" class="btn focus-btn" id="focus-btn" aria-haspopup="true" aria-expanded="false" aria-pressed="false" hidden>${icon("focus")}<span class="lbl">Focus</span></button></span>
${tour}
${present}
<span class="live-ind" id="live-ind" role="status" hidden>Live</span>
<span class="menu-wrap"><button type="button" class="btn quiet icon-only" id="theme-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu" aria-label="Colour theme" hidden>${icon("theme")}</button>
<span class="menu right" role="menu" id="theme-menu" aria-label="Colour theme" hidden>
<button type="button" role="menuitemradio" data-theme-set="auto" aria-checked="true">Auto</button>
<button type="button" role="menuitemradio" data-theme-set="light" aria-checked="false">Light</button>
<button type="button" role="menuitemradio" data-theme-set="dark" aria-checked="false">Dark</button></span></span>
</div></div></header>`;
}

function navBadges(ix: Ix): Record<string, string> {
  const b = ix.b;
  const errors = b.findings.filter((f) => f.severity === "error").length;
  const warnings = b.findings.length - errors;
  const proposed = b.patches.filter((p) => p.status === "proposed").length;
  const { ready } = readySplit(ix); // ready and not started: work in progress is not "ready"
  const out: Record<string, string> = {};
  if (ready) out.plan = `<span class="badge accent">${ready} ready</span>`;
  if (errors) out.checks = `<span class="badge danger">${errors}<span class="sr-only"> ${errors === 1 ? "error" : "errors"}</span></span>`;
  else if (warnings) out.checks = `<span class="badge">${warnings}<span class="sr-only"> ${warnings === 1 ? "warning" : "warnings"}</span></span>`;
  if (proposed) out.changes = `<span class="badge">${proposed}<span class="sr-only"> proposed</span></span>`;
  const t = b.tracker?.reconcile ? trackerCounts(b) : undefined;
  if (t && t.disagree) out.tracker = `<span class="badge warning">${t.disagree}<span class="sr-only"> disagree</span></span>`;
  const tm = b.findings.filter((f) => f.pack === "teams" && (f.rule === "team-load" || f.rule === "separation-of-duties")).length;
  if (tm) out.teams = `<span class="badge warning">${tm}<span class="sr-only"> team ${tm === 1 ? "finding" : "findings"}</span></span>`;
  const lb = loadBearing(b).length;
  if (lb) out.strategy = `<span class="badge warning">${lb}<span class="sr-only"> untested, and much rests on ${lb === 1 ? "it" : "them"}</span></span>`;
  const oq = (b.notes?.items ?? []).filter((n) => n.status === "open" && n.kind === "question").length;
  if (oq) out.notes = `<span class="badge accent">${oq}<span class="sr-only"> open ${oq === 1 ? "question" : "questions"}</span></span>`;
  return out;
}

function nav(ix: Ix): string {
  const badges = navBadges(ix);
  const pages = [PAGES[0], PAGES[1], PAGES[2], ...(ix.b.model.claims?.length ? [{ id: "strategy", label: "Strategy" }] : []), ...(ix.b.teams ? [{ id: "teams", label: "Teams" }] : []), PAGES[3], PAGES[4], ...(ix.b.tracker ? [{ id: "tracker", label: "Tracker" }] : []), { id: "notes", label: "Notes" }];
  const links = pages.map((p) => `<a href="#${p.id}" data-nav="${p.id}">${p.label}${badges[p.id] ? " " + badges[p.id] : ""}</a>`).join("");
  return `<nav class="app-nav" aria-label="Pages"><div class="inner">
<div class="nav-links">${links}</div>
<span class="nav-current" id="nav-current" aria-hidden="true">Overview</span>
<button type="button" class="btn quiet pages-btn" id="pages-btn" aria-haspopup="dialog" hidden>${icon("menu")}<span>Pages</span></button>
<span class="nav-spacer"></span>
</div></nav>
<div class="statebar" id="chipbar" role="region" aria-label="Filters, selection and trail"><div class="inner"></div></div>`;
}

// ---------- overview ----------
/** How far a milestone is: "has 5 of its 26 units done", "has 3 units, none done yet", "is complete". */
export function gateProgress(done: number, total: number): string {
  if (!total) return "has no units";
  if (done >= total) return total === 1 ? "has its one unit done" : `has all ${fmt(total)} of its units done`;
  if (!done) return total === 1 ? "has 1 unit, not done yet" : `has ${count(total, "unit")}, none done yet`;
  return `has ${fmt(done)} of its ${count(total, "unit")} done`;
}

/** The current milestone as the subject of a sentence: "The current milestone, “The loop closes once”," or "The current milestone" when it has no name. */
export function gateSubject(_n: number, name: string | undefined): string {
  const q = quote(name);
  return q ? `The current milestone, ${q},` : "The current milestone";
}

/** The design's state in one sentence: errors by rule and place, then warnings with their largest rule. */
export function designSentence(ix: Ix): string {
  const b = ix.b;
  const byRule = (sev: string) => { const m = new Map<string, number>(); for (const f of b.findings) if (f.severity === sev) m.set(`${f.pack}/${f.rule}`, (m.get(`${f.pack}/${f.rule}`) ?? 0) + 1); return m; };
  const er = byRule("error"), wr = byRule("warning");
  const errors = [...er.values()].reduce((a, c) => a + c, 0), warnings = [...wr.values()].reduce((a, c) => a + c, 0);
  const top = [...wr].sort((x, y) => y[1] - x[1] || natural(x[0], y[0]))[0];
  const topTitle = top ? quote(ix.ruleTitle.get(top[0])?.title ?? top[0]) : "";
  const warnClause = !warnings ? "" : wr.size === 1
    ? `${count(warnings, "warning")}, ${warnings === 1 ? "from" : "all from"} ${topTitle}`
    : top![1] === 1 ? `${count(warnings, "warning")}, one from each of ${count(wr.size, "rule")}`
    : `${count(warnings, "warning")} from ${count(wr.size, "rule")}; the most common is ${topTitle} (${fmt(top![1])})`;
  if (errors) {
    const lead = `The design fails ${count(er.size, "error rule")}${errors > er.size ? ` in ${count(errors, "place")}` : ""}`;
    return sentence(warnings ? `${lead}, and has ${warnClause}` : lead);
  }
  return sentence(warnings ? `The design passes every error check, with ${warnClause}` : "The design passes every check");
}

/** The Overview brief: the model, the plan, the current milestone, the design. Short sentences, one fact each. */
export function briefSentences(ix: Ix): string[] {
  const b = ix.b;
  const m = b.model;
  const out: string[] = [];
  // The plan's status and its reason first: the sentence the deck's road and the milestone's card say too. It takes the
  // place of the model's size, which the system tile still gives, so the brief stays four sentences.
  const lead = b.status?.overall.lead && b.plan.phases.length ? b.status.overall.lead.text : "";
  const things = [count(m.elements.length, "part"), count(m.relationships.length, "relationship"), m.teams.length ? count(m.teams.length, "team") : ""];
  out.push(lead || (m.elements.length ? sentence(`The model has ${list(things)}`) : "The model has no parts yet."));
  const units = b.plan.units.length, gates = ix.phaseOrder.length, { ready, moving } = readySplit(ix);
  if (!units) { out.push("The plan has no units yet."); }
  else {
    const open = [...ix.unit.values()].some((u) => u.status !== "done");
    const where = gates ? ` in ${count(gates, "milestone")}` : "";
    const mv = moving ? `, with ${fmt(moving)} already moving` : "";
    const start = !open ? "and every one is done" : ready ? `and ${ready === units ? (units === 1 ? "it" : "all of them") : fmt(ready)} can start now${mv}` : moving ? `none new can start now, and ${fmt(moving)} ${verb(moving, "is", "are")} already moving` : "and none can start now";
    out.push(sentence(`The plan has ${count(units, "unit")}${where}, ${start}`));
    const cur = currentGate(ix);
    if (cur) { const s = phaseStats(b, cur.phase.id); out.push(sentence(`${gateSubject(cur.n, cur.phase.name)} ${gateProgress(s.done, s.total)}`)); }
    else if (gates) out.push(gates === 1 ? "Its one milestone is reached." : `All ${fmt(gates)} milestones are reached.`);
  }
  out.push(designSentence(ix));
  return out;
}

function gateRoad(ix: Ix, compact: boolean): string {
  const b = ix.b;
  const cur = currentGate(ix);
  if (!ix.phaseOrder.length) return `<p class="empty">The plan has no milestones.</p>`;
  const items = ix.phaseOrder.map((p, i) => {
    const s = phaseStats(b, p.id);
    const cls = s.complete ? "passed" : cur && p.id === cur.phase.id ? "current" : "later";
    const label = p.name || p.id;
    const ms = statusOf(b, p.id);
    const st = ms && !s.complete ? `${ragHtml(ms.status, "sm")}${ms.override ? `<span class="muted xs">set manually${ms.computed !== ms.status ? `; computed ${RAG_WORD[ms.computed].toLowerCase()}` : ""}</span>` : ""}${ms.flags?.length ? `<span class="ms-flag" title="${esc(ms.flags.map((f) => f.text).join(" "))}">${icon("warning", "icon icon-sm")}Check this call</span>` : ""}` : "";
    return `<li class="${cls}${ms && !s.complete ? " rag-" + ms.status : ""}" style="--w:${Math.max(1, s.total)}" id="${esc(domId("phase", p.id))}">
<a href="${route.gate(p.id)}" data-gate="${esc(p.id)}" aria-label="${esc(label)}: ${s.done} of ${s.total} done${s.complete ? ", reached" : ms ? `, ${RAG_WORD[ms.status].toLowerCase()}${ms.override ? " (set by a person)" : ""}${ms.flags?.length ? `; ${ms.flags.map((f) => f.text.replace(/[.\s]+$/, "")).join("; ")}` : ""}` : ""}">
<span class="lab" title="${esc(label)}"><b>${esc(label)}</b>${compact ? "" : `<span class="ms-lead xs">${p.lead ? `Lead: ${esc(p.lead)}` : "No lead named"}</span>`}</span>
<span class="seg" aria-hidden="true"><span style="width:${pct(s.done, s.total)}%"></span></span>
<span class="cnt">${s.complete ? `${status("pass", "Reached", "sm")}` : `${st}<span>${s.done} / ${s.total}</span>`}</span></a></li>`;
  }).join("");
  return `<ol class="road${compact ? " compact" : ""}" aria-label="Milestones">${items}</ol>`;
}

/**
 * Needs attention, built from what a person can act on: the path to green first (red steps before amber, across the
 * milestones in plan order, one row per piece of work, each naming the record and its owner team), then open
 * questions, then proposed changes with their verdicts, and the rules last.
 */
export function attentionRows(ix: Ix): { html: string; n: number } {
  const b = ix.b;
  const rows: string[] = [];
  const group = (t: string, k: string) => `<li class="att-group" data-att="${k}">${esc(t)}</li>`;
  // 1. the path to green
  const steps: { a: PathAction; m: MilestoneStatus; i: number }[] = [];
  const seen = new Set<string>();
  const ms = (b.status?.milestones ?? []).filter((m) => !m.reached && m.computed !== "green");
  const all = ms.flatMap((m, mi) => m.path.filter((a) => a.criterion !== "earlier-milestone").map((a, i) => ({ a, m, i: mi * 1000 + i })));
  all.sort((x, y) => Number(y.a.level === "red") - Number(x.a.level === "red") || x.i - y.i);
  for (const s of all) { const k = s.a.work ? `${s.a.work.kind}:${s.a.work.id}` : s.a.text; if (seen.has(k)) continue; seen.add(k); steps.push(s); }
  const PATH_MAX = 5;
  if (steps.length) {
    rows.push(group("On the path to green", "path"));
    for (const { a, m } of steps.slice(0, PATH_MAX)) {
      const w = a.work;
      const href = !w ? route.milestone(m.phase) : w.kind === "unit" ? route.unit(w.id) : w.kind === "claim" ? `#strategy/claim/${enc(w.id)}` : w.kind === "phase" ? route.milestone(w.id) : w.kind === "finding" ? route.rule(w.id.split("/")[0], w.id.split("/")[1].split("@")[0]) : route.milestone(m.phase);
      const data = w?.kind === "unit" ? ` data-unit="${esc(w.id)}"` : w?.kind === "claim" ? ` data-claim="${esc(w.id)}"` : "";
      const names = a.teams.map((t) => ix.team.get(t) ?? t);
      // up to two owner teams by name; more than two is no clear owner
      const who = !names.length ? (m.accountable ? `Needs an owner: ${m.accountable} names one` : "Needs an owner") : names.length <= 2 ? names.join(", ") : `No clear owner: ${names.length} teams`;
      const says = a.level === "red" && w?.kind === "unit" ? trackerSays(b, w.id) : undefined;
      const meta = [`For ${quote(gateLabel(ix, m.phase))}`, says ? `${says}; settle first` : "", a.unblocks.length ? `unblocks ${count(a.unblocks.length, "unit")}` : ""].filter(Boolean).join(" · ");
      rows.push(`<li><a class="list-row att-step" href="${href}"${data}>${icon(RAG_ICON_NAME[a.level], "icon st-rag-" + a.level)}<span class="sr-only">${a.level === "red" ? "Red" : "Amber"}: </span><span class="t">${esc(a.text)}</span><span class="rv${names.length ? "" : " no-owner"}">${esc(who)}</span><span class="meta">${esc(meta)}</span></a></li>`);
    }
    if (steps.length > PATH_MAX) rows.push(`<li><a class="list-row more-row" href="#plan">${esc(`${count(steps.length - PATH_MAX, "more step")} on the path to green, on the Plan`)}</a></li>`);
  }
  // 2. open questions
  const qs = (b.notes?.items ?? []).filter((n) => n.kind === "question" && n.status === "open");
  if (qs.length) {
    rows.push(group("Open questions", "questions"));
    for (const n of qs.slice(0, 3)) rows.push(`<li><a class="list-row" href="#notes/${enc(n.id)}" title="${esc(n.id)}">${icon("k-note", "icon")}<span class="t">${esc(n.text)}</span><span class="rv">${esc(noteOn(ix, n.target))}</span></a></li>`);
    if (qs.length > 3) rows.push(`<li><a class="list-row more-row" href="#notes">${esc(`${count(qs.length - 3, "more open question")}, on Notes`)}</a></li>`);
  }
  // 3. proposed changes, each with its verdict
  const props = b.patches.filter((p) => p.status === "proposed");
  if (props.length) {
    rows.push(group("Proposed changes", "patches"));
    for (const p of props.slice(0, 3)) {
      const v = verdict(p);
      const e = p.impact.findingsIntroduced.filter((f) => f.severity === "error");
      const t = e.length ? `The proposed change ${quote(p.title)} breaks: ${ix.ruleTitle.get(`${e[0].pack}/${e[0].rule}`)?.title ?? e[0].message}` : `The proposed change ${quote(p.title)}`;
      rows.push(`<li><a class="list-row" href="${route.patch(p.id)}" title="${esc(p.id)}">${icon(v.cls, "icon st-" + v.cls)}<span class="t">${esc(t)}</span><span class="rv">${esc(v.short)}</span></a></li>`);
    }
    if (props.length > 3) rows.push(`<li><a class="list-row more-row" href="#changes">${esc(`${count(props.length - 3, "more proposed change")}, on Changes`)}</a></li>`);
  }
  // 4. the rules, last
  const groups = new Map<string, Finding[]>();
  for (const f of b.findings) groups.set(`${f.pack}/${f.rule}`, [...(groups.get(`${f.pack}/${f.rule}`) ?? []), f]);
  const ordered = [...groups].sort((x, y) => Number(y[1].some((f) => f.severity === "error")) - Number(x[1].some((f) => f.severity === "error")) || y[1].length - x[1].length || natural(x[0], y[0]));
  const ruleRow = ([k, fs]: [string, Finding[]]) => {
    const [pack, rule] = [fs[0].pack, fs[0].rule];
    const sev = fs.some((f) => f.severity === "error") ? "fail" : "warning";
    const kinds = [...new Set(fs.map((f) => f.atKind))];
    const noun = kinds.length === 1 ? (NOUN[kinds[0]] ?? ["place", "places"])[fs.length === 1 ? 0 : 1] : fs.length === 1 ? "place" : "places";
    const rv = k === "teams/unit-has-owner" ? (() => { const sp = unassignedSplit(ix, fs); return sp.cur ? `${fmt(sp.here.length)} in this milestone · ${fmt(fs.length)} in all` : `${fs.length} ${noun}`; })() : `${fs.length} ${noun}`;
    return `<li><a class="list-row" href="${route.rule(pack, rule)}">${icon(sev, "icon st-" + sev)}<span class="t">${esc(ix.ruleTitle.get(k)?.title ?? k)}</span><span class="rv">${rv}</span><span class="sr-only">${sev === "fail" ? "Error" : "Warning"}</span></a></li>`;
  };
  const RULE_MAX = 3;
  if (ordered.length) {
    rows.push(group("Checks", "rules"));
    for (const g of ordered.slice(0, RULE_MAX)) rows.push(ruleRow(g));
    if (ordered.length > RULE_MAX) rows.push(`<li><a class="list-row more-row" href="#checks">${esc(`${count(ordered.length - RULE_MAX, "more rule")} with findings, on Checks`)}</a></li>`);
  }
  return { html: rows.join(""), n: steps.length + qs.length + props.length + ordered.length };
}

/** "on <the record's name>": what a note is pinned to, by name. */
function noteOn(ix: Ix, t: { kind: string; id: string }): string {
  const b = ix.b;
  const name = t.kind === "unit" ? ix.unit.get(t.id)?.title : t.kind === "element" ? ix.el.get(t.id)?.name : t.kind === "phase" ? gateLabel(ix, t.id)
    : t.kind === "claim" ? (() => { const c = b.model.claims?.find((x) => x.id === t.id); return c ? claimShort(c.statement) : undefined; })()
    : t.kind === "patch" ? b.patches.find((p) => p.id === t.id)?.title : t.kind === "finding" ? ix.ruleTitle.get(t.id.split("@")[0])?.title : undefined;
  const short = (x: string) => (x.length > 48 ? x.slice(0, 48).replace(/\s+\S*$/, "") + "…" : x);
  return name ? `On ${quote(short(name))}` : "";
}

/** The Overview's tiles: each a question, a number and one line, and the work area it switches to. */
export function overviewTiles(ix: Ix): { key: string; q: string; big: string; line: string; tone?: "fail" | "warning" }[] {
  const b = ix.b;
  const errors = b.findings.filter((f) => f.severity === "error").length;
  const warnings = b.findings.length - errors;
  const warnRules = new Set(b.findings.filter((f) => f.severity === "warning").map((f) => f.pack + "/" + f.rule)).size;
  const cur = currentGate(ix);
  const ready = (b.analysis?.frontier ?? []).length;
  const cp = (b.analysis?.critical_path ?? []).length;
  const proposed = b.patches.filter((p) => p.status === "proposed");
  const breaking = proposed.filter((p) => p.impact.findingsIntroduced.some((f) => f.severity === "error")).length;
  const tiles: { key: string; q: string; big: string; line: string; tone?: "fail" | "warning" }[] = [];
  tiles.push({ key: "design", q: "Is the design sound?", big: errors ? status("fail", `Fails ${errors}`) : status("pass", "Passes"), line: warnings ? `${plural(warnings, "warning")} from ${plural(warnRules, "rule")}` : "No warnings", tone: errors ? "fail" : undefined });
  if (b.plan.units.length) {
    const st = cur ? phaseStats(b, cur.phase.id) : undefined;
    const ov = b.status?.overall;
    tiles.push({ key: "plan", q: "Where is the plan?", big: !cur ? status("done", "Complete") : ov ? ragHtml(ov.status) : `<span class="big-name">${esc(cur.phase.name || cur.phase.id)}</span>`, line: `${cur ? `Now: ${cur.phase.name || cur.phase.id} · ${fmt(st!.done)} of ${fmt(st!.total)} done` : `${fmt(ready)} ready`}`, tone: ov?.status === "red" ? "fail" : ov?.status === "amber" ? "warning" : undefined });
  }
  // flow, on an instance with a value stream: lead time, the share of it spent waiting, handoffs against the limit
  const ft = FLOWUI.tile(b);
  if (ft) tiles.push({ key: "flow", q: "How does work flow?", big: `<span class="big-name">${esc(ft.big)}</span>`, line: ft.line, tone: ft.bad ? "warning" : undefined });
  // a 0.4 design's outside parts (a shared part, another design's) are drawn at its edge and owned elsewhere: counted apart
  const own = b.model.elements.filter((e) => !e.home), outside = b.model.elements.length - own.length;
  const unowned = own.filter((e) => !e.owner).length;
  const zones = b.zoneScenes?.length ?? 0;
  tiles.push({ key: "system", q: "What is the system?", big: plural(own.length, "part"), line: [zones ? `in ${plural(b.zoneScenes!.filter((z) => z.zone != null).length, "zone")}` : `${plural(b.model.relationships.length, "relationship")}`, outside ? `${fmt(outside)} outside it` : "", unowned ? `${fmt(unowned)} without an owner team` : ""].filter(Boolean).join(" · "), tone: unowned ? "warning" : undefined });
  if (b.model.claims?.length) {
    const lb = loadBearing(b).length, untested = b.model.claims.filter((c) => c.grade === "untested").length;
    tiles.push({ key: "premises", q: "What is it betting on?", big: plural(b.model.claims.length, "claim"), line: lb ? `${fmt(lb)} untested, and much rests on ${lb === 1 ? "it" : "them"}` : untested ? `${fmt(untested)} untested` : "Every claim is graded", tone: lb ? "warning" : undefined });
  }
  tiles.push({ key: "changes", q: "What is changing?", big: proposed.length ? plural(proposed.length, "proposed change") : "No proposed changes", line: breaking ? (breaking === proposed.length ? (breaking === 1 ? "It breaks a check" : "All of them break a check") : `${fmt(breaking)} ${verb(breaking, "breaks", "break")} a check`) : proposed.length ? (proposed.length === 1 ? "It breaks no check" : "None of them breaks a check") : b.patches.length ? `${plural(b.patches.length, "patch")} in all` : "No patches yet", tone: breaking ? "fail" : undefined });
  const tc = b.tracker?.reconcile ? trackerCounts(b) : undefined;
  if (tc) tiles.push({ key: "tracker", q: "Is the tracker in step?", big: `${tc.linked} matched`, line: `${tc.disagree ? `${tc.disagree} disagree` : "Agrees"} · ${tc.proposed} to confirm`, tone: tc.disagree ? "warning" : undefined });
  else if (b.teams) {
    const un = b.teams.unassigned.reduce((n, g) => n + g.open, 0);
    tiles.push({ key: "owners", q: "Who owns the work?", big: un ? `${fmt(un)} unowned` : "All owned", line: un ? `open ${verb(un, "unit", "units")} with no owner team` : "Every open unit has an owner team", tone: un ? "warning" : undefined });
  }
  return tiles.slice(0, ft ? 7 : 6);
}

/** The Overview's flow work area: the stream's numbers, its handoffs ranked, what the tracker measured, and the way to the map. */
function flowPanel(ix: Ix): string {
  const b = ix.b, st = b.flow!.streams[0];
  const link = (id: string) => `<a href="${route.element(id)}" data-element="${esc(id)}">${esc(b.model.elements.find((e) => e.id === id)?.name ?? id)}</a>`;
  return `<div class="section-head"><h2>${esc(st.title)}</h2><a class="btn" href="${route.view(st.view)}">Open the stream map</a></div>${FLOWUI.panel(b, st.view, link).replace('<h3 id="h-flow">Flow along this stream</h3>', "")}`;
}

function overview(ix: Ix): string {
  const b = ix.b;
  const tiles = overviewTiles(ix);
  const att = attentionRows(ix);
  const s = b.summary;
  const glanceTable = s ? `<details class="disc twin"><summary>Table version</summary><div class="body"><div class="table-wrap"><table><caption class="sr-only">Parts by ${s.by}</caption><thead><tr><th scope="col">${s.by === "zone" ? "Zone" : "System"}</th><th scope="col">Parts</th><th scope="col">Relationships out to other ${s.by}s</th></tr></thead><tbody>${s.groups.map((g) => {
    const out = s.edges.filter((e) => e.from === g.id && e.to !== g.id).reduce((n, e) => n + e.count, 0);
    const href = s.by === "zone" && b.zoneScenes?.some((z) => (z.zone ?? "") === g.id) ? `#model/zone/${enc(g.id || "_none")}` : g.view ? route.view(g.view) : "";
    return `<tr><td>${href ? `<a href="${href}">${esc(g.name)}</a>` : esc(g.name)}</td><td class="n">${g.elements.length}</td><td class="n">${out}</td></tr>`;
  }).join("")}</tbody></table></div></div></details>` : "";
  const built = b.engine?.built ? b.engine.built : "";
  const panel = (key: string, body: string) => `<div class="work-panel" id="work-${key}" data-panel="${key}" role="tabpanel" aria-labelledby="tile-${key}"${key === "design" ? "" : " hidden"}>${body}</div>`;
  const bars = (key: string) => `<div class="bars" data-bars="${key}"></div>`;
  const panels = [
    panel("design", `<div class="work-grid"><section aria-labelledby="h-attn"><div class="section-head"><h2 id="h-attn">Needs attention</h2>${att.n > 5 ? `<a class="small" href="#checks">All checks</a>` : ""}</div>
${att.html ? `<ul class="attention panel" style="padding:0">${att.html}</ul>` : `<p class="empty">Nothing needs attention: every check passes and no proposed change breaks one.</p>`}</section>${bars("design")}</div>`),
    b.plan.units.length ? panel("plan", `${ix.phaseOrder.length ? `<section class="section" aria-labelledby="h-road-o"><div class="section-head"><h2 id="h-road-o">Milestones</h2><a class="small" href="#plan">Open the plan</a></div>${gateRoad(ix, true)}</section>` : ""}${bars("plan")}`) : "",
    b.flow ? panel("flow", flowPanel(ix)) : "",
    panel("system", `<div class="work-grid wide-first">${s ? `<section aria-labelledby="h-glance"><div class="section-head"><h2 id="h-glance">System at a glance</h2><p>One box per ${s.by}; a line joins two that relationships cross between, thicker for more. Select a box to open ${s.by === "zone" ? "that zone" : "its view"}.</p></div>
<div class="canvas landscape" id="landscape" data-diagram="summary"><noscript><p class="placeholder">The landscape drawing needs JavaScript; the table below has the same counts.</p></noscript></div>
${glanceTable}</section>` : ""}${bars("system")}</div>`),
    b.model.claims?.length ? panel("premises", bars("premises")) : "",
    panel("changes", bars("changes")),
    tiles.some((t) => t.key === "tracker") ? panel("tracker", bars("tracker")) : "",
    tiles.some((t) => t.key === "owners") ? panel("owners", bars("owners")) : "",
  ].join("");
  return `<section class="page" id="overview" data-page="overview" aria-labelledby="h-overview">
<div class="page-head"><h1 id="h-overview" tabindex="-1">${esc(b.instance.title)}</h1></div>
<section class="since" id="since" aria-labelledby="h-since" hidden></section>
<p class="brief" id="brief">${briefSentences(ix).map(esc).join(" ")}</p>
${b.instance.description ? `<p class="reading fg2" style="margin:-8px 0 var(--sp-5)">${esc(b.instance.description)}</p>` : ""}
<div class="tiles" role="tablist" aria-label="What the work area below shows" style="--tiles:${tiles.length}">${tiles.map((t, i) => `<a class="tile${t.tone ? " bad-" + t.tone : ""}" role="tab" id="tile-${t.key}" href="#overview/${t.key}" data-tile="${t.key}" aria-controls="work-${t.key}" aria-selected="${i === 0}"><span class="q">${esc(t.q)}</span><span class="big">${t.big}</span><span class="line">${esc(t.line)}</span></a>`).join("")}</div>
<p class="small filter-line" id="work-filter" hidden></p>
<div class="work" id="work">${panels}</div>
<details class="disc about section" id="about"><summary>About this build</summary><div class="body"><dl>
<dt>Built</dt><dd><time datetime="${esc(built)}" data-human>${esc(built)}</time></dd>
<dt>Engine</dt><dd>Plumb ${esc(b.engine?.version ?? "")}</dd>
<dt>Packs</dt><dd>${b.instance.packs.map((p) => esc(p.name)).join(", ") || "none"}</dd>
<dt>Content hash</dt><dd><code title="${esc(b.engine?.hash ?? "")}">${esc((b.engine?.hash ?? "").slice(0, 12))}</code> <button type="button" class="copy-btn" data-copy="${esc(b.engine?.hash ?? "")}" hidden>Copy</button></dd>
${b.engine?.modelHash ? `<dt>Model hash</dt><dd><code title="${esc(b.engine.modelHash)}">${esc(b.engine.modelHash.slice(0, 12))}</code> <span class="muted small">what patches are written against</span></dd>` : ""}
</dl></div></details>
</section>`;
}

// ---------- plan ----------
export function planBrief(ix: Ix): string {
  const b = ix.b;
  if (!b.plan.units.length) return "The plan has no units yet.";
  const cur = currentGate(ix);
  const ready = (b.analysis?.frontier ?? []).length;
  const open = [...ix.unit.values()].filter((u) => u.status !== "done").length;
  const waiting = open - ready - [...ix.unit.values()].filter((u) => u.status === "doing" && !ix.frontier.has(u.id)).length;
  const cp = (b.analysis?.critical_path ?? []).length;
  const parts: string[] = [];
  if (cur) { const s = phaseStats(b, cur.phase.id); parts.push(`${gateSubject(cur.n, cur.phase.name)} ${gateProgress(s.done, s.total)}`); if (ix.phaseOrder.length > cur.n) parts.push(ix.phaseOrder.length - cur.n === 1 ? "One more milestone follows it" : `${fmt(ix.phaseOrder.length - cur.n)} more milestones follow it`); }
  else parts.push(ix.phaseOrder.length ? "Every milestone is reached" : "Every unit is done");
  if (open) {
    const w = waiting > 0 ? `${fmt(waiting)} ${verb(waiting, "waits", "wait")} on a capability` : "";
    if (open === 1) parts.push(ready ? "The one open unit can start now" : "The one open unit waits on a capability");
    else { const sp = readySplit(ix); parts.push(`Of the ${count(open, "open unit")}, ${sp.ready ? fmt(sp.ready) : "none"} can start now${sp.moving ? `, ${fmt(sp.moving)} ${verb(sp.moving, "is", "are")} already moving` : ""}${w ? ` and ${w}` : ""}`); }
  }
  if (cp) parts.push(cp === 1 ? "One unit is left on the longest chain" : `The longest remaining chain is ${count(cp, "unit")}`);
  if ([...ix.unit.values()].every((u) => !ownersOf(ix, u).length)) parts.push("No unit has an owner team yet");
  else if (cur && b.teams) {
    const un = b.teams.unassigned.find((g) => g.phase === cur.phase.id)?.open ?? 0;
    if (un) parts.push(`${count(un, "open unit")} in this milestone ${verb(un, "has", "have")} no owner team`);
  }
  return para(parts);
}

/** A capability key in words, as the client's capWords: "cap.stage-timestamps" reads “stage timestamps”. */
export const capWords = (c: string, ix?: Ix) => quote(capabilityName(c, ix?.b.plan.capabilities));

/** Each capability a unit requires that no done unit provides yet: its key, its words and the open units that provide it. */
export function unmetCaps(ix: Ix, u: Unit): { cap: string; words: string; providers: string[] }[] {
  return [...new Set(u.requires ?? [])].flatMap((c) => {
    const prov = (ix.providers.get(c) ?? []).filter((p) => p !== u.id && ix.unit.has(p)).sort(natural);
    if (prov.some((p) => ix.unit.get(p)!.status === "done")) return [];
    return [{ cap: c, words: capWords(c, ix), providers: prov }];
  });
}

/** Alternatives in words: "A", "either one: A or B", "any one of A, B or C" (items are HTML). */
export function altHtml(items: string[]): string {
  if (items.length <= 1) return items.join("");
  const head = items.slice(0, -1).join(", "), last = items[items.length - 1];
  return `<span class="alt">${items.length === 2 ? "either one:" : "any one of"}</span> ${head} or ${last}`;
}

/**
 * Why a blocked unit cannot start, in its row: one clause per capability it still needs (two, then a count), each
 * naming the capability and the unit or units that provide it; several providers are alternatives, and it says so.
 */
export function waitsWhy(ix: Ix, u: Unit): string {
  const s = unitState(ix, u);
  if (s !== "blocked" && s !== "noprov") return "";
  const missing = unmetCaps(ix, u);
  if (!missing.length) return `<span class="why">Waits on unfinished units</span>`;
  const short = (t: string) => (t.length > 44 ? t.slice(0, 44).replace(/\s+\S*$/, "") + "…" : t);
  const one = (g: { cap: string; words: string; providers: string[] }) => {
    const cap = `<span class="blk-cap" title="${esc(g.cap)}">${esc(g.words)}</span>`;
    if (!g.providers.length) return across(ix, g.cap) ? `${cap} from ${esc(across(ix, g.cap))}` : `${cap}, which no unit provides`;
    // two providers by title, then a count: a row stays one line's worth on a large plan
    const ps = g.providers.slice(0, 2).map((p) => { const pu = ix.unit.get(p)!, st = unitState(ix, pu); return `<a href="${route.unit(p)}" data-unit="${esc(p)}">${esc(short(pu.title))}</a> (${UNIT_WORD[st].toLowerCase()})`; });
    if (g.providers.length > 2) ps.push(count(g.providers.length - 2, "other unit"));
    return `${cap} from ${altHtml(ps)}`;
  };
  const shown = missing.slice(0, 2).map(one);
  return `<span class="why">${s === "noprov" ? "Cannot start: needs" : "Waits on"} ${shown.join(", and ")}${missing.length > 2 ? `, and ${count(missing.length - 2, "more capability", "more capabilities")}` : ""}</span>`;
}

/** The facts a can-start row answers "whom do I ask, and is it already moving" with (exported for tests). */
export function canStartFacts(ix: Ix, id: string): { owner: string; owners: string[]; milestone: string; due?: string; overdue?: number; tracker?: { issue: string; status: string }; redPath: string[] } {
  const b = ix.b, u = ix.unit.get(id)!;
  const owners = ownersOf(ix, u);
  // up to two owner teams by name; past two, no team clearly owns it
  const owner = owners.length && owners.length <= 2 ? owners.map((o) => ix.team.get(o) ?? o).join(", ") : owners.length ? `No clear owner (${owners.length} teams)` : "needs an owner";
  const out: ReturnType<typeof canStartFacts> = { owner, owners, milestone: gateLabel(ix, u.phase), redPath: [] };
  if (u.due) {
    out.due = u.due;
    const asOf = (b.engine.built ?? "").slice(0, 10), due = u.due.slice(0, 10);
    if (/^\d{4}-\d\d-\d\d$/.test(asOf) && /^\d{4}-\d\d-\d\d$/.test(due) && due < asOf) out.overdue = Math.round((Date.parse(asOf) - Date.parse(due)) / 86400000);
  }
  const st = b.tracker?.reconcile?.state?.[id];
  if (st) out.tracker = { issue: st.issue, status: st.status };
  for (const m of b.status?.milestones ?? []) if (m.status === "red" && m.path.some((a) => a.work?.kind === "unit" && a.work.id === id)) out.redPath.push(gateLabel(ix, m.phase));
  return out;
}

function canRow(ix: Ix, r: { id: string; total: number }): string {
  const u = ix.unit.get(r.id)!;
  const s = unitState(ix, u);
  const f = canStartFacts(ix, r.id);
  const tags: string[] = [];
  for (const m of f.redPath) tags.push(`<span class="tag danger">${icon("rag-red", "icon icon-sm")}On the path to green for ${esc(quote(m))}</span>`);
  tags.push(`<span class="tag owner${f.owners.length && f.owners.length <= 2 ? "" : " warning"}"${f.owners.length > 1 ? ` title="${esc(list(f.owners.map((o) => ix.team.get(o) ?? o)))}"` : ""}>${esc(f.owners.length ? f.owner : "Needs an owner")}</span>`);
  tags.push(`<span class="tag">${esc(f.milestone)}</span>`);
  if (f.due) tags.push(f.overdue ? `<span class="tag danger">${esc(`Due ${dayText(f.due)}, ${count(f.overdue, "day")} overdue`)}</span>` : `<span class="tag">${esc(`Due ${dayText(f.due)}`)}</span>`);
  if (f.tracker) tags.push(`<span class="tag" title="${esc(f.tracker.issue)}">${esc(`Tracker: ${f.tracker.status}`)}</span>`);
  const rd = readiesOf(ix, r.id);
  const rv = !r.total ? "unblocks nothing yet" : [rd.readies.length ? `readies ${fmt(rd.readies.length)}` : "", rd.closer ? `moves ${fmt(rd.closer)} closer` : ""].filter(Boolean).join(" · ");
  return `<li><a class="list-row" href="${route.unit(u.id)}" data-unit="${esc(u.id)}" title="${esc(u.id)}">${status(s, UNIT_WORD[s], "sm")}<span class="t">${esc(u.title)}</span><span class="rv" title="${esc(`Unblocks ${count(r.total, "unit")} in all, directly or through others`)}">${esc(rv)}</span>
<span class="meta">${tags.join("")}</span></a></li>`;
}


/** The open unit inside or before a milestone that the most of the milestone's open units wait on directly. */
export function gatingUnit(ix: Ix, phaseId: string): { id: string; waiting: number; open: number } | undefined {
  const b = ix.b;
  const open = [...ix.unit.values()].filter((u) => u.phase === phaseId && u.status !== "done");
  const counts = new Map<string, number>();
  for (const u of open) for (const d of b.analysis?.deps?.[u.id] ?? []) if (ix.unit.get(d)?.status !== "done") counts.set(d, (counts.get(d) ?? 0) + 1);
  const best = [...counts].sort((x, y) => y[1] - x[1] || natural(x[0], y[0]))[0];
  return best && best[1] >= 2 ? { id: best[0], waiting: best[1], open: open.length } : undefined;
}

/** A milestone's work by owner team: ready, in progress, and blocked with what each waits on and whose it is. */
export function teamPlan(ix: Ix, phaseId: string): string {
  const b = ix.b;
  const open = [...ix.unit.values()].filter((u) => u.phase === phaseId && u.status !== "done");
  if (!open.length) return "";
  const teamsOf = (u: Unit) => ownersOf(ix, u);
  const tn = (t: string) => ix.team.get(t) ?? t;
  const whoText = (u: Unit) => { const o = teamsOf(u).map(tn); return !o.length ? "no owner team" : o.length <= 2 ? o.join(", ") : `${o.length} teams`; };
  const trackerChip = (id: string) => { const st = b.tracker?.reconcile?.state?.[id]; return st ? `<span class="tag" title="${esc(st.issue)}">${esc(trackerWord(b))}: ${esc(st.status)}</span>` : ""; };
  // the first capability it still needs and who provides it (alternatives said so), then how many more
  const waitsOn = (u: Unit) => {
    const miss = unmetCaps(ix, u);
    if (!miss.length) return "";
    const g = miss[0], cap = `<span class="blk-cap" title="${esc(g.cap)}">${esc(g.words)}</span>`;
    const who = g.providers.length ? ` from ${altHtml(g.providers.map((p) => { const d = ix.unit.get(p)!; return `<a href="${route.unit(d.id)}" data-unit="${esc(d.id)}">${esc(d.title)}</a> (${esc(whoText(d))})`; }))}` : " (no unit provides it)";
    return `waits on ${cap}${who}${miss.length > 1 ? ` and ${esc(count(miss.length - 1, "more capability", "more capabilities"))}` : ""}`;
  };
  const row = (u: Unit, extra = "") => `<li data-unit-row="${esc(u.id)}"><a href="${route.unit(u.id)}" data-unit="${esc(u.id)}">${esc(u.title)}</a>${extra ? ` <span class="small fg2">${extra}</span>` : ""} ${trackerChip(u.id)}</li>`;
  const dueText = (u: Unit) => { const f = canStartFacts(ix, u.id); return f.due ? esc(`due ${dayText(f.due)}${f.overdue ? `, ${count(f.overdue, "day")} overdue` : ""}`) : ""; };
  const MAX = 6;
  const listOf = (title: string, us: Unit[], extra: (u: Unit) => string, team: string) => us.length ? `<h4 class="small fg2">${esc(title)} <span class="count">${us.length}</span></h4><ul class="rows">${us.slice(0, MAX).map((u) => row(u, extra(u))).join("")}${us.length > MAX ? `<li><a class="small" href="#plan/units?milestone=${enc(phaseId)}${team ? `&owner=${enc(team)}` : ""}">${esc(`${fmt(us.length - MAX)} more in the table`)}</a></li>` : ""}</ul>` : "";
  const keys = new Map<string, Unit[]>();
  for (const u of open) { const o = teamsOf(u); for (const t of o.length ? o : [""]) keys.set(t, [...(keys.get(t) ?? []), u]); }
  const order = [...keys].sort((x, y) => Number(x[0] === "") - Number(y[0] === "") || y[1].length - x[1].length || natural(tn(x[0]), tn(y[0])));
  const blocks = order.map(([t, us]) => {
    const st = (u: Unit) => unitState(ix, u);
    const ready = us.filter((u) => st(u) === "ready"), doing = us.filter((u) => st(u) === "doing"), blocked = us.filter((u) => st(u) === "blocked" || st(u) === "noprov");
    const sum = [ready.length ? `${fmt(ready.length)} ready` : "", doing.length ? `${fmt(doing.length)} in progress` : "", blocked.length ? `${fmt(blocked.length)} blocked` : ""].filter(Boolean).join(" · ");
    return `<details class="disc team-plan" data-team-plan="${esc(t)}"${order.length <= 6 ? " open" : ""}><summary><span>${t ? `${icon("k-team", "icon icon-sm")}${esc(tn(t))}` : `${icon("warning", "icon icon-sm st-warning")}No owner team`}</span><span class="muted small">${esc(sum)}</span></summary><div class="body">${listOf("Ready to start", ready, dueText, t)}${listOf("In progress", doing, dueText, t)}${listOf("Blocked", blocked, waitsOn, t)}</div></details>`;
  }).join("");
  const g = gatingUnit(ix, phaseId);
  const gu = g ? ix.unit.get(g.id)! : undefined;
  const gate = gu ? `<p class="small gating">${icon("warning", "icon icon-sm st-warning")}<span><a href="${route.unit(gu.id)}" data-unit="${esc(gu.id)}">${esc(quote(gu.title))}</a> holds up ${fmt(g!.waiting)} of the ${fmt(g!.open)} open units here directly (${esc(whoText(gu))}${gu.phase !== phaseId ? `, in ${esc(quote(gateLabel(ix, gu.phase)))}` : ""}).</span></p>` : "";
  const readyN = open.filter((u) => unitState(ix, u) === "ready").length;
  return `<section class="team-plans" data-team-plans="${esc(phaseId)}"><h3 class="small fg2" style="margin-top:var(--sp-4)">Open work by team</h3><p class="small fg2">${esc(readyN ? `${count(readyN, "unit")} in this milestone can start now.` : "Nothing in this milestone can start now.")}</p>${gate}${blocks}</section>`;
}
const trackerWord = (b: Bundle) => (b.tracker?.adapter === "jira" ? "Jira" : b.tracker?.adapter ?? "Tracker");

function plan(ix: Ix): string {
  const b = ix.b;
  const ranked = rankedFrontier(ix);
  // ready work and work already in progress are different asks: "who starts this" against "who is on it"
  const can = ranked.filter((r) => ix.unit.get(r.id)!.status !== "doing").map((r) => canRow(ix, r)).join("");
  const moving = ranked.filter((r) => ix.unit.get(r.id)!.status === "doing").map((r) => canRow(ix, r)).join("");
  const cpIds = b.analysis?.critical_path ?? [];
  const firstOpen = cpIds.find((id) => ix.unit.get(id)?.status !== "done");
  const chain = cpIds.map((id) => {
    const u = ix.unit.get(id);
    const s = u ? unitState(ix, u) : "blocked";
    return `<li class="${id === firstOpen ? "next" : ""}"><a href="${route.unit(id)}" class="${gateClass(ix, u?.phase ?? "")}" data-unit="${esc(id)}" title="${esc(id)}">${icon(s, "icon icon-sm st-" + s)}<span class="sr-only">${UNIT_WORD[s]}: </span><span class="tt">${esc(u?.title ?? id)}</span></a>${id === firstOpen ? `<span class="nextlab">Next on the path</span>` : ""}</li>`;
  }).join("");

  const gatePanels = ix.phaseOrder.map((p, i) => {
    const s = phaseStats(b, p.id);
    const caps = [...new Set([...ix.unit.values()].filter((u) => u.phase === p.id).flatMap((u) => u.provides ?? []))].sort(natural);
    return `<section class="gate-panel panel pad" data-gate-panel="${esc(p.id)}" aria-labelledby="h-gate-${esc(domId("g", p.id))}">
<div class="section-head"><h2 id="h-gate-${esc(domId("g", p.id))}">${esc(p.name || p.id)}</h2><p>${s.done} of ${s.total} done${s.complete ? " · reached" : ""}${p.target ? ` · planned for ${esc(dayText(p.target))}` : ""}</p></div>
${statusBlock(b, p.id)}
${p.delivers ? `<h3 class="small fg2">What it delivers</h3><p class="reading">${esc(p.delivers)}</p>` : ""}${p.means ? `<h3 class="small fg2" style="margin-top:var(--sp-3)">What reaching it lets us do</h3><p class="reading">${esc(p.means)}</p>` : ""}
<h3 class="small fg2"${p.delivers || p.means ? ' style="margin-top:var(--sp-3)"' : ""}>Reached when</h3><p class="reading">${esc(p.exit_test || "No definition of done written.")}</p>
${teamPlan(ix, p.id)}
<p class="small" style="margin-top:var(--sp-3)"><a href="#plan/units?milestone=${enc(p.id)}">Show its ${plural(s.total, "unit")} in the table</a></p>
<div class="slot" data-claims-for="phase:${esc(p.id)}"></div><div class="slot" data-notes-for="phase:${esc(p.id)}"></div>
${caps.length ? `<details class="how" style="margin-top:var(--sp-3)"><summary>Under the hood: capabilities it provides <span class="muted">${caps.length}</span></summary><div class="chips" style="margin-top:6px">${caps.slice(0, 30).map((c) => `<span class="chip">${esc(c)}</span>`).join("")}${caps.length > 30 ? `<span class="muted small">and ${caps.length - 30} more</span>` : ""}</div></details>` : ""}
</section>`;
  }).join("");

  const units = [...ix.unit.values()].sort((a, c) => (ix.phase.get(a.phase)?.order ?? 1e9) - (ix.phase.get(c.phase)?.order ?? 1e9) || natural(a.id, c.id));
  const anyOwner = units.some((u) => ownersOf(ix, u).length);
  const tracker = !!b.tracker?.reconcile;
  const rows = units.map((u) => {
    const s = unitState(ix, u);
    const bl = b.analysis?.blocked?.[u.id];
    const waits = s === "done" ? "" : s === "ready" || s === "doing" ? "Ready" : count(bl ? bl.missing.length : (u.requires ?? []).length, "capability", "capabilities");
    const text = [u.id, u.title, u.check, ...(u.requires ?? []), ...(u.provides ?? []), ...(u.elements ?? []).map((m) => ix.el.get(m.id)?.name ?? m.id)].join(" ").toLowerCase();
    const els = (u.elements ?? []).map((m) => m.id).join(" ");
    const missing = (bl?.missing ?? []).join(" ");
    return `<tr id="${esc(domId("unit", u.id))}" data-unit="${esc(u.id)}" data-gate="${esc(u.phase)}" data-state="${s}" data-owner="${esc(ownersOf(ix, u).join(" "))}" data-kind="${esc(u.kind)}" data-els="${esc(els)}" data-missing="${esc(missing)}" data-text="${esc(text)}">
<td class="lead inline" data-label="Status" data-sort="${["ready", "doing", "blocked", "noprov", "done"].indexOf(s)}">${status(s, UNIT_WORD[s], "sm")}</td><td class="inline hide-narrow" data-label="Id"><span class="id">${esc(u.id)}</span></td>
<td class="lead" data-label="Unit"><a href="${route.unit(u.id)}" data-unit="${esc(u.id)}"><span class="sr-only">${esc(u.id)} </span>${esc(u.title)}</a>${waitsWhy(ix, u)}</td>
<td class="inline" data-label="Milestone" data-sort="${ix.phaseOrder.findIndex((p) => p.id === u.phase)}">${esc(gateLabel(ix, u.phase))}</td><td class="inline" data-label="Kind">${esc(u.kind)}</td>
${anyOwner ? `<td class="inline" data-label="Owner team">${ownersOf(ix, u).length ? esc(list(ownersOf(ix, u).map((o) => ix.team.get(o) ?? o))) : `<span class="muted">None</span>`}</td>` : ""}
<td class="inline n" data-label="" data-sort="${bl ? bl.missing.length : s === "done" ? 99 : 0}">${esc(waits)}</td>${tracker ? `<td class="inline" data-label="Issue">${ix.issueOf.has(u.id) ? `<span class="id">${esc(ix.issueOf.get(u.id)!)}</span>` : ""}</td>` : ""}</tr>`;
  }).join("\n");
  const opt = (vals: [string, string][]) => vals.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const kinds = [...new Set(units.map((u) => u.kind))].sort(natural);
  const owners = [...new Set(units.flatMap((u) => ownersOf(ix, u)))].sort(natural);
  const blockedCaps = [...new Set(Object.values(b.analysis?.blocked ?? {}).flatMap((x) => x.missing))].sort(natural);

  return `<section class="page" id="plan" data-page="plan" aria-labelledby="h-plan">
<div class="page-head"><h1 id="h-plan" tabindex="-1">Plan</h1></div>
<div class="plan-layout" id="plan-layout"><div class="plan-main" style="min-width:0">
${b.status ? `<p class="status-line">${ragHtml(b.status.overall.status)}<span>${esc(b.status.overall.lead?.text ?? b.status.overall.text)}</span></p>` : ""}
<p class="brief">${esc(planBrief(ix))}</p>
<section aria-labelledby="h-road"><h2 id="h-road" class="sr-only">Milestones</h2>${gateRoad(ix, false)}</section>
<div id="gate-panels">${gatePanels}</div>
${historyStrip(b)}
<div class="grid-2 section">
<section aria-labelledby="h-can"><div class="section-head"><h2 id="h-can">Can start now</h2><p>Ready and not yet started, ranked by how many units each one unblocks, directly or through others; each says who owns it</p></div>
<div id="can-chip"></div>
${can ? `<ul class="panel can-list" style="padding:0;list-style:none" id="can-list">${can}</ul><p class="empty" id="can-none" hidden>None of the units that can start now match the filters.</p>` : `<p class="empty">${[...ix.unit.values()].some((u) => u.status !== "done") ? (moving ? "Nothing new can start: the ready work is already in progress." : "Nothing can start: every open unit waits on another.") : "Every unit is done."}</p>`}
${moving ? `<h3 class="small fg2" id="h-moving" style="margin-top:var(--sp-4)">Already moving <span class="muted">in progress, ranked the same way</span></h3><ul class="panel can-list" style="padding:0;list-style:none" id="can-moving">${moving}</ul>` : ""}</section>
<section aria-labelledby="h-cp"><div class="section-head"><h2 id="h-cp">Critical path</h2></div>
${cpIds.length ? `<p class="small fg2" style="margin-bottom:var(--sp-3)">${esc(cpIds.length === 1 ? "One unit is left on the longest chain." : `These ${plural(cpIds.length, "unit")} must finish one after another; no other chain in the plan is longer.`)}</p><ol class="chain" aria-label="Critical path, in order">${chain}</ol>` : `<p class="empty">No dependency chain remains.</p>`}</section>
</div>
<details class="disc section" id="plan-shape-box"><summary><h2 style="font-size:var(--fs-lg)">Plan shape</h2><span class="muted small">open work by when it can start</span></summary><div class="body" style="padding-left:0"><div class="shape-wrap"><div class="shape" id="plan-shape"><noscript><p class="empty">The chart needs JavaScript; the table below lists every unit.</p></noscript></div></div></div></details>
<section class="section" aria-labelledby="h-units"><div class="section-head"><h2 id="h-units">All work</h2></div>
<form class="filters" id="unit-filters" role="search" aria-label="Filter units" onsubmit="return false">
<label class="field grow">Search<input type="search" id="f-text" placeholder="Title, id, capability, part" autocomplete="off"></label>
<label class="field">Milestone<select id="f-gate"><option value="">All</option>${opt(ix.phaseOrder.map((p) => [p.id, p.name || p.id]))}</select></label>
<label class="field">Status<select id="f-state"><option value="">All</option>${opt([["ready", "Ready"], ["doing", "In progress"], ["blocked", "Blocked"], ["noprov", "Needs work (unplanned)"], ["done", "Done"]])}</select></label>
<label class="field">Kind<select id="f-kind"><option value="">All</option>${opt(kinds.map((k) => [k, k]))}</select></label>
${owners.length ? `<label class="field">Owner team<select id="f-owner"><option value="">All</option>${opt(owners.map((o) => [o, ix.team.get(o) ?? o]))}</select></label>` : ""}
<label class="field">Part<select id="f-el"><option value="">All</option>${opt([...ix.el.values()].filter((e) => units.some((u) => u.elements?.some((m) => m.id === e.id))).sort((a, c) => natural(a.name, c.name)).map((e) => [e.id, e.name]))}</select></label>
${blockedCaps.length ? `<label class="field">Missing capability<select id="f-cap"><option value="">Any</option>${opt(blockedCaps.map((c) => [c, capabilityName(c, b.plan.capabilities)]))}</select></label>` : ""}
<button type="reset" class="btn" id="f-clear">Clear</button>
</form>
<p class="filter-count" id="unit-count" aria-live="polite">${plural(units.length, "unit")}</p>
<div class="table-wrap reflow"><table class="reflow units-table" id="units-table"><caption class="sr-only">All work</caption><thead><tr>
<th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="0">Status</button></th><th scope="col" aria-sort="ascending"><button type="button" class="sort" data-sort-col="1">Id</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="2">Unit</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="3">Milestone</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="4">Kind</button></th>${anyOwner ? `<th scope="col">Owner team</th>` : ""}<th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="${anyOwner ? 6 : 5}">Waiting on</button></th>${tracker ? `<th scope="col">Issue</th>` : ""}</tr></thead>
<tbody id="unit-rows">${rows}</tbody></table></div>
<p class="empty" id="unit-none" hidden>No units match these filters.</p>
</section>
</div>
<aside class="plan-aside" id="unit-aside" aria-label="Unit detail" hidden><div class="inspector" id="unit-detail" tabindex="-1"></div></aside>
</div>
</section>`;
}

// ---------- model ----------
function model(ix: Ix): string {
  const b = ix.b;
  const groups = b.viewGroups?.length ? b.viewGroups : [{ name: "Views", views: b.model.views.map((v) => v.id) }];
  const rail = groups.map((g) => `<li class="rail-group"><div class="gname">${esc(g.name)}</div><ul class="rail-list">${g.views.filter((id) => ix.view.has(id)).map((id) => {
    const v = ix.view.get(id)!;
    return `<li><a href="${route.view(id)}" id="${esc(domId("view", id))}" data-view="${esc(id)}" data-text="${esc((v.title + " " + id + " " + (v.description ?? "")).toLowerCase())}"><span class="vt">${esc(v.title)}</span><span class="n">${v.elements?.length ?? 0}</span></a></li>`;
  }).join("")}</ul></li>`).join("");
  const zoneIdx = new Map(b.model.zones.map((z, i) => [z.id, i]));
  const zoneRail = (b.zoneScenes ?? []).length ? `<li class="rail-group"><div class="gname">Zones</div><ul class="rail-list">${b.zoneScenes!.map((s) => {
    const zid = s.zone ?? "_none", i = s.zone == null ? undefined : zoneIdx.get(s.zone);
    return `<li><a href="#model/zone/${enc(zid)}" data-view="__zone:${esc(zid)}" data-text="${esc((s.name + " zone " + zid).toLowerCase())}"><span class="vt"><i class="swatch ${i == null ? "t0" : "t" + ((i % 6) + 1)}" aria-hidden="true"></i> ${esc(s.name)}</span><span class="n">${s.layout.nodes.length}</span></a></li>`;
  }).join("")}</ul></li>` : "";
  const railHtml = `<label class="field" style="margin-bottom:var(--sp-2)"><span class="sr-only">Filter views</span><input type="search" class="view-filter" placeholder="Filter ${plural(b.model.views.length, "view")}" autocomplete="off"></label>
<ul class="rail-list">${zoneRail}${rail}</ul>
<ul class="rail-list" style="margin-top:var(--sp-3);border-top:1px solid var(--border);padding-top:var(--sp-2)">
<li><a href="#model/elements" data-view="__elements"><span class="vt">All parts</span><span class="n">${b.model.elements.length}</span></a></li>
${b.summary && b.summary.groups.length >= 2 ? `<li><a href="#model/matrix" data-view="__matrix"><span class="vt">${b.summary.by === "zone" ? "Zone" : "System"} matrix</span><span class="n">${b.summary.groups.length}</span></a></li>` : ""}
</ul>`;
  const els = [...b.model.elements].sort((a, c) => natural(a.name, c.name));
  const fcount = new Map<string, number>();
  for (const f of b.findings) if (f.atKind === "element") fcount.set(f.at, (fcount.get(f.at) ?? 0) + 1);
  // current state (0.4): a part that exists only today, and a record no person has confirmed, are marked where the part shows
  const cur = new Map((b.current?.records ?? []).map((c) => [c.part, c]));
  const curTags = (id: string) => { const c = cur.get(id); return c ? `${c.todayOnly ? ` <span class="tag">Today only</span>` : ""}${c.state === "discovered" ? ` <span class="tag warning" title="${esc(c.text)}">Discovered</span>` : ""}` : ""; };
  const rows = els.map((e) => `<tr id="${esc(domId("element", e.id))}" data-element="${esc(e.id)}" data-kind="${esc(e.kind)}" data-zone="${esc(e.zone ?? "")}" data-owner="${esc(e.owner ?? "")}" data-text="${esc([e.id, e.name, e.kind, e.description ?? ""].join(" ").toLowerCase())}">
<td class="lead" data-label="Part"><a href="${route.element(e.id)}" data-element="${esc(e.id)}">${esc(e.name)}</a>${curTags(e.id)}</td><td class="inline" data-label="Kind">${esc(e.kind)}</td>
<td class="inline" data-label="Zone">${e.zone ? esc(ix.zone.get(e.zone) ?? e.zone) : ""}</td><td class="inline" data-label="Owner team">${e.owner ? esc(ix.team.get(e.owner) ?? e.owner) : `<span class="st warning sm">${icon("warning")}<span class="w">No owner team</span></span>`}${deciderOf(e).length ? ` <span class="small fg2 decides" style="display:block">Decided by: ${esc(list(deciderOf(e).map((t) => ix.team.get(t) ?? t)))}</span>` : ""}</td>
<td class="inline n" data-label="Problems">${fcount.get(e.id) ?? ""}</td></tr>`).join("\n");
  const opt = (vals: [string, string][]) => vals.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const kinds = [...new Set(els.map((e) => e.kind))].sort(natural);
  const zones = [...new Set(els.map((e) => e.zone).filter(Boolean) as string[])];
  const owners = [...new Set(els.map((e) => e.owner ?? ""))].sort(natural);
  return `<section class="page" id="model" data-page="model" aria-labelledby="h-model">
<div class="page-head"><h1 id="h-model" tabindex="-1">Model</h1><p class="muted">${plural(b.model.elements.length, "part")}, ${plural(b.model.relationships.length, "relationship")}, ${plural(b.model.views.length, "view")}</p>
<button type="button" class="btn views-btn" id="views-btn" aria-haspopup="dialog" hidden>Views</button></div>
<div class="model-layout" id="model-layout">
<nav class="rail" id="views-rail" aria-label="Views">${railHtml}</nav>
<div class="model-main" id="model-main">
<div id="diagram-area"><noscript><p class="empty">Diagrams need JavaScript. The list of every part below works without it.</p></noscript></div>
<section id="model-elements" aria-labelledby="h-all-el">
<div class="section-head"><h2 id="h-all-el">All parts</h2></div>
<form class="filters" id="el-filters" role="search" aria-label="Filter parts" onsubmit="return false">
<label class="field grow">Search<input type="search" id="el-text" placeholder="Name, id, kind" autocomplete="off"></label>
<label class="field">Kind<select id="el-kind"><option value="">All</option>${opt(kinds.map((k) => [k, k]))}</select></label>
${zones.length ? `<label class="field">Zone<select id="el-zone"><option value="">All</option>${opt(zones.map((z) => [z, ix.zone.get(z) ?? z]))}</select></label>` : ""}
<label class="field">Owner team<select id="el-owner"><option value="">All</option>${opt(owners.map((o) => [o || "__none", o ? ix.team.get(o) ?? o : "No owner team"]))}</select></label>
</form>
<p class="filter-count" id="el-count" aria-live="polite">${plural(els.length, "part")}</p>
<div class="table-wrap reflow"><table class="reflow" id="el-table"><caption class="sr-only">All parts</caption><thead><tr><th scope="col" aria-sort="ascending"><button type="button" class="sort" data-sort-col="0">Part</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="1">Kind</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="2">Zone</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="3">Owner team</button></th><th scope="col" aria-sort="none"><button type="button" class="sort" data-sort-col="4">Problems</button></th></tr></thead>
<tbody id="element-rows">${rows}</tbody></table></div></section>
<section id="model-matrix" aria-labelledby="h-matrix" hidden><div class="section-head"><h2 id="h-matrix">Which boundaries do relationships cross?</h2><p>Rows are where a relationship starts, columns where it ends. Select a cell to list them.</p></div><div id="matrix-area"></div></section>
</div>
<aside class="inspector-col" aria-label="Inspector"><div class="inspector" id="inspector" tabindex="-1"></div></aside>
</div>
</section>`;
}

// ---------- checks ----------
function checks(ix: Ix): string {
  const b = ix.b;
  const byRule = new Map<string, Finding[]>();
  for (const f of b.findings) byRule.set(f.pack + "/" + f.rule, [...(byRule.get(f.pack + "/" + f.rule) ?? []), f]);
  const errors = b.findings.filter((f) => f.severity === "error").length;
  const warnings = b.findings.length - errors;
  const allRules = b.instance.packs.flatMap((p) => p.rules.map((r) => p.name + "/" + r.id));
  const passing = allRules.filter((k) => !byRule.has(k)).length;
  const seen = new Set<string>();
  const packs = b.instance.packs.map((p) => {
    const rules = [...p.rules].sort((a, c) => {
      const fa = byRule.get(p.name + "/" + a.id) ?? [], fc = byRule.get(p.name + "/" + c.id) ?? [];
      const sa = fa.some((f) => f.severity === "error") ? 2 : fa.length ? 1 : 0, sc = fc.some((f) => f.severity === "error") ? 2 : fc.length ? 1 : 0;
      return sc - sa || fc.length - fa.length;
    }).map((r) => { seen.add(p.name + "/" + r.id); return ruleBlock(ix, p.name, r.id, r.title, r.why, r.severity, byRule.get(p.name + "/" + r.id) ?? []); }).join("");
    const failing = p.rules.filter((r) => byRule.has(p.name + "/" + r.id)).length;
    return `<section class="pack" id="${esc(domId("pack", p.name))}" data-pack="${esc(p.name)}" data-failing="${failing}" aria-labelledby="h-pack-${esc(p.name)}"><div class="pack-head"><h2 id="h-pack-${esc(p.name)}">${esc(p.title)}</h2><p>${esc(para([failing ? `${fmt(failing)} of its ${plural(p.rules.length, "rule")} ${verb(failing, "reports", "report")} findings` : p.rules.length === 1 ? "Its one rule passes" : `All ${plural(p.rules.length, "rule")} pass`, p.description]))}</p></div>${rules || `<p class="empty">This pack has no rules.</p>`}</section>`;
  });
  const orphan = [...byRule.entries()].filter(([k]) => !seen.has(k));
  if (orphan.length) packs.push(`<section class="pack" data-pack="other" data-failing="${orphan.length}"><div class="pack-head"><h2>Other problems found</h2><p>Problems from checks this bundle does not describe.</p></div>${orphan.map(([k, fs]) => ruleBlock(ix, fs[0].pack, fs[0].rule, k, "", fs[0].severity, fs)).join("")}</section>`);
  // failing packs first
  const order = packs.map((h, i) => ({ h, f: /data-failing="(\d+)"/.exec(h)?.[1] ?? "0", i })).sort((x, y) => Number(y.f !== "0") - Number(x.f !== "0") || x.i - y.i).map((x) => x.h).join("");
  const kinds = [...new Set(b.findings.map((f) => f.atKind))];
  return `<section class="page" id="checks" data-page="checks" aria-labelledby="h-checks">
<div class="page-head"><h1 id="h-checks" tabindex="-1">Checks</h1></div>
<div class="summary-bar">${errors ? status("fail", `Fails ${errors}`) : status("pass", "Passes")}<span class="fg2">${warnings ? plural(warnings, "warning") : "No warnings"} · ${passing === allRules.length ? (allRules.length === 1 ? "its one rule passes" : `all ${plural(allRules.length, "rule")} pass`) : `${fmt(passing)} of ${plural(allRules.length, "rule")} pass`}</span></div>
<div class="filters chipbar" id="check-filters" role="group" aria-label="Filter findings" hidden>
<button type="button" class="fchip" data-f="sev" data-v="error" aria-pressed="false">Errors</button><button type="button" class="fchip" data-f="sev" data-v="warning" aria-pressed="false">Warnings</button>
${b.instance.packs.length > 1 ? b.instance.packs.map((p) => `<button type="button" class="fchip" data-f="pack" data-v="${esc(p.name)}" aria-pressed="false">${esc(p.title)}</button>`).join("") : ""}
${kinds.length > 1 ? kinds.map((k) => `<button type="button" class="fchip" data-f="kind" data-v="${esc(k)}" aria-pressed="false">${esc(KIND_LABEL[k] ?? k)}</button>`).join("") : ""}
<label class="check" style="margin-left:auto"><input type="checkbox" id="show-passing"> Show passing checks</label>
</div>
<div id="checks-pinned"></div>
<p class="small filter-line" id="checks-filtered" hidden></p>
${order || `<p class="empty">No rule packs ran.</p>`}
</section>`;
}

/** Unassigned units in the current milestone, and the rest by milestone: the UI lists only the current one's, to avoid noise. */
export function unassignedSplit(ix: Ix, fs: Finding[]): { cur?: { n: number; name: string }; here: Finding[]; later: { n: number; name: string; count: number }[] } {
  const cur = currentGate(ix);
  const gateN = (id: string) => ix.phaseOrder.findIndex((p) => p.id === id) + 1;
  const here = cur ? fs.filter((f) => ix.unit.get(f.at)?.phase === cur.phase.id) : fs;
  const by = new Map<number, number>();
  for (const f of fs) { const u = ix.unit.get(f.at); if (u && (!cur || u.phase !== cur.phase.id)) by.set(gateN(u.phase), (by.get(gateN(u.phase)) ?? 0) + 1); }
  return { ...(cur ? { cur: { n: cur.n, name: cur.phase.name } } : {}), here, later: [...by].sort((a, c) => a[0] - c[0]).map(([n, c]) => ({ n, name: ix.phaseOrder[n - 1]?.name ?? String(n), count: c })) };
}

/** The rule's key and severity, for the author, behind a closed disclosure: never on the page's face. */
function howChecked(pack: string, rule: string, severity: string, how?: string): string {
  return `<details class="how"><summary>How this is checked</summary><p class="small fg2">Rule <code>${esc(pack)}/${esc(rule)}</code> in the ${esc(pack)} pack, severity ${esc(severity)}.${how ? ` ${esc(how)}` : ""} Run <code>bun plumb.ts check</code> to list its findings with their ids.</p></details>`;
}

function ruleBlock(ix: Ix, pack: string, rule: string, title: string, why: string, severity: string, fsAll: Finding[]): string {
  const failing = fsAll.length > 0;
  // unassigned work is counted per milestone and listed for the current one only; the badge keeps the total
  const split = pack === "teams" && rule === "unit-has-owner" && failing ? unassignedSplit(ix, fsAll) : undefined;
  const fs = split ? split.here : fsAll;
  const gateNote = split?.cur ? `<p class="small fg2" style="margin:0 0 6px">${esc(sentence(`${split.here.length ? `Listed: the ${count(split.here.length, "unit")} in the current milestone, ${quote(split.cur.name)}` : `None in the current milestone, ${quote(split.cur.name)}`}${split.later.length ? `; ${split.here.length ? "also " : ""}${list(split.later.map((g) => `${fmt(g.count)} in ${quote(g.name)}`))}` : ""}`))}</p>` : "";
  const sev = fsAll.some((f) => f.severity === "error") ? "error" : "warning";
  const diffs = messageDiffs(fs, (f) => subjectName(ix, f));
  const subjects = fs.map((f, i) => `<li data-at="${esc(f.atKind + ":" + f.at)}" data-sev="${f.severity}" data-kind="${esc(f.atKind)}">${subjectLink(ix, f)}${diffs[i] ? ` <span class="diff">${esc(diffs[i])}</span>` : ""}</li>`).join("");
  const long = diffs.some((d) => d.length > 40);
  const kinds = [...new Set(fsAll.map((f) => f.atKind))].join(" ");
  return `<details class="rule${failing ? " failing " + sev : " passing"}" id="${esc(domId("rule", pack + "-" + rule))}" data-rule="${esc(pack + "/" + rule)}" data-sev="${failing ? sev : "pass"}" data-kinds="${esc(kinds)}"${failing ? " open" : ""}>
<summary>${failing ? icon(sev === "error" ? "fail" : "warning", "icon st-" + (sev === "error" ? "fail" : "warning")) : icon("pass", "icon st-pass")}<span class="rt">${esc(title)}</span><span class="rmeta"><span class="tag">${severity === "error" ? "Error rule" : "Warning rule"}</span>${failing ? `<span class="badge ${sev === "error" ? "danger" : "warning"}">${fsAll.length}<span class="sr-only"> ${fsAll.length === 1 ? "finding" : "findings"}</span></span>` : `<span class="st pass sm"><span class="w">Passes</span></span>`}<span class="chev" aria-hidden="true"></span></span></summary>
<div class="rbody">${why ? `<p class="why">${esc(why)}</p>` : ""}${gateNote}${failing && fs.length ? `<ul class="subjects${long ? " long" : ""}">${subjects}</ul>` : ""}${howChecked(pack, rule, severity, ix.ruleTitle.get(`${pack}/${rule}`)?.how)}${failing ? `<div class="slot" data-notes-for="finding-rule:${esc(pack + "/" + rule)}"></div>` : ""}</div></details>`;
}

// ---------- changes ----------
function opText(ix: Ix, p: Patch & { impact: Impact }, op: Patch["ops"][number]): string {
  const snap = (kind: string, id: string) => p.impact.records?.[`${kind}:${id}`];
  const kindWord = (k: string) => (KIND_LABEL[k] ?? k).toLowerCase();
  if (!op || typeof op !== "object") return "An operation that is not a mapping";
  if (op.op === "add") {
    const v = op.value as Record<string, unknown>;
    const id = String(v?.id ?? v?.name ?? "");
    const s = snap(op.kind, id);
    return `<span class="sym add" aria-hidden="true">+</span>Adds ${kindWord(op.kind)} ${s ? recordRef(ix, op.kind, id, s) : `<span class="id">${esc(id)}</span>`}`;
  }
  if (op.op === "remove") {
    const s = snap(op.kind, op.id);
    return `<span class="sym rem" aria-hidden="true">&#8722;</span>Removes ${kindWord(op.kind)} ${s ? `<span>${esc(s.name)}</span>${s.name === op.id ? "" : ` <span class="id">${esc(op.id)}</span>`}` : `<span class="id">${esc(op.id)}</span>`}`;
  }
  if (op.op === "modify") {
    const s = snap(op.kind, op.id);
    const fields = Object.keys((op as any).set ?? {});
    return `<span class="sym mod" aria-hidden="true">~</span>Changes ${fields.map(esc).join(", ") || "nothing"} on ${kindWord(op.kind)} ${s ? recordRef(ix, op.kind, op.id, s) : `<span class="id">${esc(op.id)}</span>`}`;
  }
  return esc(JSON.stringify(op));
}

/**
 * The verdict line, Terraform-shaped: the lead ("Breaks 1 check" or "Passes every check"), then one token per non-zero
 * count, each a number with its noun. A zero is left out rather than printed ("fixes 0" reads as noise); a patch that
 * changes no record says so.
 */
/** Knock-on records, one per record: a view that loses a part and its relationships is one record with two reasons. */
export function distinctCascade(im: Impact): { kind: RecordKind; id: string; because: string }[] {
  const by = new Map<string, { kind: RecordKind; id: string; because: string }>();
  for (const c of im.cascade) {
    const k = `${c.kind}:${c.id}`, x = by.get(k);
    if (x) { if (!x.because.split("; ").includes(c.because)) x.because += "; " + c.because; }
    else by.set(k, { kind: c.kind, id: c.id, because: c.because });
  }
  return [...by.values()];
}

export function verdict(p: Patch & { impact: Impact }): { lead: string; cls: "fail" | "warning" | "pass"; short: string; tokens: { text: string; warn?: boolean }[]; reasons: string[] } {
  const im = p.impact;
  const breaks = im.findingsIntroduced.filter((f) => f.severity === "error").length;
  const newWarn = im.findingsIntroduced.length - breaks;
  const gone = (im.findingsGone ?? []).length;
  const units = im.unitsAffected.length;
  const tokens: { text: string; warn?: boolean }[] = [];
  if (newWarn) tokens.push({ text: count(newWarn, "new warning"), warn: true });
  if (im.findingsResolved.length) tokens.push({ text: `fixes ${count(im.findingsResolved.length, "finding")}` });
  if (gone) tokens.push({ text: `${fmt(gone)} no longer ${verb(gone, "applies", "apply")}`, warn: true });
  if (im.removed.length) tokens.push({ text: `− ${fmt(im.removed.length)} removed` });
  if (im.added.length) tokens.push({ text: `+ ${fmt(im.added.length)} added` });
  if (im.modified.length) tokens.push({ text: `~ ${fmt(im.modified.length)} changed` });
  const knock = distinctCascade(im).length;
  if (knock) tokens.push({ text: `↳ ${count(knock, "knock-on change")}` });
  if (!im.removed.length && !im.added.length && !im.modified.length && !im.cascade.length) tokens.push({ text: "no record changes" });
  if (units) tokens.push({ text: `touches ${count(units, "unit")}` });
  // The core's verdict decides the colour: a patch that passes the checks but loses findings with a removed record,
  // names work that is not done, or claims what no operation does, is amber, never green.
  const level = im.verdict?.level ?? (breaks ? "fail" : "pass");
  const reasons = im.verdict?.reasons ?? [];
  if (level === "fail") return { lead: `Breaks ${count(Math.max(breaks, 1), "check")}`, short: `Breaks ${count(Math.max(breaks, 1), "check")}`, cls: "fail", tokens, reasons };
  if (level === "caution") return { lead: "Passes the checks, but review before accepting", short: "Review", cls: "warning", tokens, reasons };
  return { lead: "Passes every check", short: "Passes", cls: "pass", tokens, reasons };
}

function findingRow(ix: Ix, f: Finding, withWhy: boolean): string {
  const r = ix.ruleTitle.get(`${f.pack}/${f.rule}`);
  return `<li class="${withWhy ? "problem" : ""}"><span>${icon(f.severity === "error" ? "fail" : "warning", "icon st-" + (f.severity === "error" ? "fail" : "warning"))} <a href="${route.rule(f.pack, f.rule)}">${esc(r?.title ?? f.rule)}</a></span>
<span>${subjectLink(ix, f)}</span><span class="small fg2">${esc(f.text ?? f.message)}</span>${withWhy && r?.why ? `<span class="small muted">${esc(r.why)}</span>` : ""}</li>`;
}

/** A patch's lead-time effect on each stream view: the sentence with its source words, then before and after. */
function flowEffectSection(ix: Ix, im: Impact): string {
  if (!im.flow?.length) return "";
  const b = ix.b;
  const hops = (xs: { fromTeam: string; toTeam: string }[]) => xs.map((h) => esc(FLOWUI.hop(b, h))).join(", ");
  return im.flow.map((e) => `<section class="patch-sec flow-effect" data-flow-effect="${esc(e.view)}"><h3>Lead-time effect on “${esc(e.title)}”</h3><p class="reading">${esc(e.text)}</p>
<div class="table-wrap reflow"><table class="reflow"><caption class="sr-only">Before and after</caption><thead><tr><th scope="col"></th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>
<tr><td class="lead" data-label="">Declared wait on the path</td><td class="inline" data-label="Before">${esc(FLOWUI.days(e.wait.before))}</td><td class="inline" data-label="After">${esc(FLOWUI.days(e.wait.after))}</td></tr>
${e.lead ? `<tr><td class="lead" data-label="">Lead time, declared wait and work</td><td class="inline" data-label="Before">${esc(FLOWUI.days(e.lead.before))}</td><td class="inline" data-label="After">${esc(FLOWUI.days(e.lead.after))}</td></tr>` : ""}
<tr><td class="lead" data-label="">Team handoffs (limit ${e.handoffs.limit})</td><td class="inline" data-label="Before">${e.handoffs.before}</td><td class="inline" data-label="After">${e.handoffs.after}, ${esc(FLOWUI.limitWords(e.handoffs.after, e.handoffs.limit))}</td></tr>
${e.hopsAdded.length || e.hopsRemoved.length ? `<tr><td class="lead" data-label="">Cross-team hops</td><td class="inline" data-label="Before">${e.hopsRemoved.length ? `gone: ${hops(e.hopsRemoved)}` : ""}</td><td class="inline" data-label="After">${e.hopsAdded.length ? `new: ${hops(e.hopsAdded)}` : ""}</td></tr>` : ""}
</tbody></table></div></section>`).join("");
}

/**
 * Who proposed a patch: a person (by role; `author: person` takes the role from requested_by), or an agent at
 * someone's request. The change review leads with it, so a reader knows whose change it is before its verdict.
 */
export function proposer(pv: Patch["provenance"]): { agent: boolean; who: string; html: string } | undefined {
  if (!pv) return undefined;
  if (pv.author === "agent" || pv.agent) {
    const tool = pv.agent ? ` (${pv.agent.tool}${pv.agent.model ? `, model ${pv.agent.model}` : ""})` : "";
    return { agent: true, who: "An agent", html: `an agent${esc(tool)}${pv.requested_by ? ` at the request of <b>${esc(pv.requested_by)}</b>` : ""}` };
  }
  const role = pv.author && pv.author !== "person" ? pv.author : pv.requested_by;
  const asked = pv.author && pv.author !== "person" && pv.requested_by && pv.requested_by !== pv.author ? pv.requested_by : undefined;
  const who = role ?? "a person";
  return { agent: false, who, html: `<b>${esc(who)}</b>${asked ? ` at the request of <b>${esc(asked)}</b>` : ""}` };
}

function patchDetail(ix: Ix, p: Patch & { impact: Impact }): string {
  const b = ix.b;
  const im = p.impact;
  const v = verdict(p);
  const pv = p.provenance;
  const stale = pv?.based_on && b.engine?.modelHash && !b.engine.modelHash.startsWith(pv.based_on) && !pv.based_on.startsWith(b.engine.modelHash.slice(0, pv.based_on.length));
  const by = proposer(pv);
  const proposedLine = `<p class="proposer"><span class="pb-l">Proposed by</span> <span class="pb-who">${by ? by.html : "nobody recorded"}</span>${by ? (by.agent ? `<span class="tag agent">${icon("agent", "icon icon-sm")}Agent-written</span>` : `<span class="tag person">Written by a person</span>`) : ""}</p>`;
  const provLine = pv
    ? `${pv.created ? `<span class="muted">Written <time datetime="${esc(pv.created)}" data-human>${esc(pv.created)}</time></span>` : ""}${pv.based_on ? `<span class="muted">· against model <code>${esc(pv.based_on.slice(0, 12))}</code></span>` : ""}${stale ? `<span class="tag warning">Written against an older model</span>` : ""}${pv.request ? `<span class="muted small" style="flex-basis:100%">Request: ${esc(pv.request)}</span>` : ""}`
    : `<span class="muted">Not recorded: give the patch a provenance with its author (a person's role, or agent) and who asked for it</span>`;
  const ops = (p.ops ?? []).map((op) => `<li>${opText(ix, p, op)}</li>`).join("");
  const unbacked = im.unbacked ?? [];
  const recSnap = (kind: string, id: string) => im.records?.[`${kind}:${id}`];
  const diffGroup = (sym: string, symCls: string, title: string, items: { kind: RecordKind; id: string; extra?: string }[], open = false) => {
    if (!items.length) return "";
    const byKind = new Map<string, typeof items>();
    for (const it of items) byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), it]);
    const summaryCounts = [...byKind].map(([k, xs]) => `${xs.length} ${(NOUN[k] ?? [k, k + "s"])[xs.length === 1 ? 0 : 1]}`).join(" · ");
    return `<details class="disc diffgroup"${open ? " open" : ""}><summary><span class="sym ${symCls}" aria-hidden="true">${sym}</span><span>${esc(title)} <span class="count">${items.length}</span></span><span class="muted small">${esc(summaryCounts)}</span></summary><div class="body">${[...byKind].map(([k, xs]) => `<h4 class="small fg2" style="margin-top:6px">${esc((NOUN[k] ?? [k, k + "s"])[1].replace(/^./, (c) => c.toUpperCase()))}</h4><ul class="rows">${xs.map((x) => `<li>${k === "element" || k === "relationship" || k === "unit" || k === "view" || k === "phase" ? recordRef(ix, x.kind, x.id, recSnap(x.kind, x.id)) : `<span>${esc(recSnap(x.kind, x.id)?.name ?? x.id)}</span>`}${x.extra ? ` <span class="small muted">${x.extra}</span>` : ""}</li>`).join("")}</ul>`).join("")}</div></details>`;
  };
  const fieldText = (kind: string, id: string) => (im.fieldChanges ?? []).filter((f) => f.kind === kind && f.id === id).map((f) => {
    const before = f.before === undefined ? [] : f.before.split(", "), after = f.after === undefined ? [] : f.after.split(", ");
    const isList = before.length > 1 || after.length > 1;
    if (isList) {
      const gone = before.filter((x) => !after.includes(x)), added = after.filter((x) => !before.includes(x));
      return `<span class="fieldchg"><span><code>${esc(f.field)}</code>: ${gone.map((x) => `<span class="sym rem" aria-hidden="true">&#8722;</span><span class="sr-only">removed </span>${esc(x)}`).join(" ")} ${added.map((x) => `<span class="sym add" aria-hidden="true">+</span><span class="sr-only">added </span>${esc(x)}`).join(" ")}</span></span>`;
    }
    return `<span class="fieldchg"><span><code>${esc(f.field)}</code>: <span class="b">${esc(f.before ?? "(unset)")}</span> &#8594; ${esc(f.after ?? "(unset)")}</span></span>`;
  }).join("");
  const cascadeByKind = distinctCascade(im).map((c) => ({ ...c, extra: esc(c.because) }));
  const decision = p.decision ? `<section class="patch-sec"><h3>Decision</h3><p class="small">${esc(PATCH_LABEL[p.status] ?? p.status)} by ${esc(p.decision.by)} · <time datetime="${esc(p.decision.at)}" data-human>${esc(p.decision.at)}</time>${p.decision.reason ? `: ${esc(p.decision.reason)}` : ""}</p></section>` : "";
  const file = p.file ?? `patches/${p.id}.yaml`;
  const act = p.status === "proposed" ? `Accept by setting <code>status: accepted</code> in <code>${esc(file)}</code>, then rebuild.` : p.status === "accepted" ? `Included in the compiled model. Undo by setting <code>status: rejected</code> in <code>${esc(file)}</code>, then rebuild.` : `Not in the compiled model. Reconsider by setting <code>status: proposed</code> in <code>${esc(file)}</code>.`;
  const copyText = p.status === "proposed" ? `status: accepted  # ${file}` : `${file}`;
  return `<article class="patch" id="${esc(domId("patch", p.id))}" data-patch="${esc(p.id)}" data-hash="${esc(patchHash(p))}" aria-labelledby="h-patch-${esc(domId("p", p.id))}">
<div class="patch-head"><h2 id="h-patch-${esc(domId("p", p.id))}" tabindex="-1">${esc(p.title)}</h2><div class="tags"><span class="id">${esc(p.id)}</span><span class="tag ${p.status === "accepted" ? "success" : p.status === "rejected" ? "" : "accent"}">${esc(PATCH_LABEL[p.status] ?? p.status)}</span></div></div>
${proposedLine}
<p class="prov">${provLine}</p>
<p class="verdict" aria-label="Verdict"><span class="lead ${v.cls}">${icon(v.cls)} ${esc(v.lead)}</span>${v.tokens.map((t) => `<span class="tok${t.warn ? " warn" : ""}">${esc(t.text)}</span>`).join("")}</p>
${v.reasons.length ? `<ul class="verdict-why rows" aria-label="Why not green">${v.reasons.map((r) => `<li>${icon(v.cls === "fail" ? "fail" : "warning", "icon st-" + (v.cls === "fail" ? "fail" : "warning"))} <span>${esc(r)}</span></li>`).join("")}</ul>` : ""}
${im.errors.length ? `<div class="callout danger" style="margin-bottom:var(--sp-4)">${icon("fail")}<div><b>Could not apply ${plural(im.errors.length, "operation")}</b><ul class="rows">${im.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div></div>` : ""}
<div class="claim"><section><h3>Why</h3><p class="reading" data-linkify>${esc(p.why || "No reason written.")}</p></section>
<section><h3>What it changes</h3>${ops ? `<ul class="ops">${ops}</ul>` : `<p class="empty">No operations.</p>`}</section></div>
${unbacked.length ? `<div class="callout warning" style="margin-top:var(--sp-4)">${icon("warning")}<div><b>Mentioned but not changed.</b> The description names ${list(unbacked.map((u) => `${recordRef(ix, u.kind, u.id, recSnap(u.kind, u.id))}${u.kind === "contract" || recSnap(u.kind, u.id)?.name === u.id ? "" : ` <span class="id">${esc(u.id)}</span>`}`))}, but no operation changes ${unbacked.length === 1 ? "it" : "them"}. Check that ${unbacked.length === 1 ? "it is" : "they are"} context and not a claimed change.</div></div>` : (im.mentioned?.length ? `<p class="small muted" style="margin-top:var(--sp-3)">Every id the description names is changed by the patch.</p>` : "")}
${flowEffectSection(ix, im)}
${im.findingsIntroduced.length ? `<section class="patch-sec problems"><h3>New problems · ${im.findingsIntroduced.length}</h3><ul class="rows" style="gap:8px">${im.findingsIntroduced.map((f) => findingRow(ix, f, true)).join("")}</ul></section>` : ""}
${im.drawing ? changeSection(ix, p) : ""}
<section class="patch-sec"><h3>Every record it changes</h3>
${diffGroup("−", "rem", "Removed", im.removed, true)}${diffGroup("+", "add", "Added", im.added, true)}${diffGroup("~", "mod", "Changed", im.modified.map((m) => ({ ...m, extra: fieldText(m.kind, m.id) || esc(m.fields.join(", ")) })), true)}${diffGroup("↳", "", "Knock-on", cascadeByKind)}
${!im.removed.length && !im.added.length && !im.modified.length && !im.cascade.length ? `<p class="empty">No record changes.</p>` : ""}</section>
${im.unitsAffected.length ? `<section class="patch-sec"><h3>Work affected · ${im.unitsAffected.length}</h3><ul class="rows work-rows">${im.unitsAffected.map((u) => affectedRow(ix, u)).join("")}</ul></section>` : ""}
<section class="patch-sec"><details class="disc"><summary><h3 style="margin:0">Fixed · ${im.findingsResolved.length}</h3></summary><div class="body">${im.findingsResolved.length ? `<ul class="rows">${im.findingsResolved.map((f) => findingRow(ix, f, false)).join("")}</ul>` : `<p class="empty">This patch fixes no finding.</p>`}</div></details>
<details class="disc"><summary><h3 style="margin:0">No longer applies · ${(im.findingsGone ?? []).length}</h3></summary><div class="body"><p class="small fg2" style="margin-bottom:6px">These warnings pointed at things this patch removes. Their disappearance is not a fix.</p>${(im.findingsGone ?? []).length ? `<ul class="rows">${im.findingsGone!.map((f) => findingRow(ix, f, false)).join("")}</ul>` : `<p class="empty">None.</p>`}</div></details></section>
${decision}
<div class="slot" data-notes-for="patch:${esc(p.id)}"></div>
<div class="review" data-review="${esc(p.id)}" hidden><label class="check"><input type="checkbox" data-review-box> Mark reviewed</label><span class="small muted" data-review-note></span></div>
<p class="howto">${act} <button type="button" class="copy-btn" data-copy="${esc(copyText)}" hidden>Copy</button></p>
${im.verdict ? `<p class="howto" data-reject>${esc(im.verdict.reject)}</p><p class="howto" data-revise>${esc(im.verdict.revise)} <button type="button" class="copy-btn" data-copy="${esc((/tell Claude: “(.*)”$/.exec(im.verdict.revise) ?? [, im.verdict.revise])[1])}" hidden>Copy</button></p>` : ""}
</article>`;
}

/** What one record is called on the page: the compiled model's name, else the patch's snapshot of it. */
function nameOf(ix: Ix, im: Impact, kind: string, id: string): string {
  if (kind === "element") return ix.el.get(id)?.name ?? im.records?.[`element:${id}`]?.name ?? id;
  if (kind === "view") return ix.view.get(id)?.title ?? im.records?.[`view:${id}`]?.name ?? id;
  return im.records?.[`${kind}:${id}`]?.name ?? id;
}

/** The sentence over the change drawing: what is drawn, what the colours mean, what was left out. */
export function changeCaption(ix: Ix, p: Patch & { impact: Impact }): string {
  const im = p.impact, dr = im.drawing, ch = dr?.change;
  if (!dr) return "";
  if (!ch) return para([`The drawing is ${quote(dr.title)}, before and after the patch`]);
  const action = (id: string) => dr.removed.includes(id) || im.removed.some((t) => t.kind === "element" && t.id === id) ? "removed" : dr.added.includes(id) || im.added.some((t) => t.kind === "element" && t.id === id) ? "added" : dr.changed.includes(id) || im.modified.some((t) => t.kind === "element" && t.id === id) ? "changed" : "";
  const named = ch.centre.map((id) => { const a = action(id); return nameOf(ix, im, "element", id) + (a ? ` (${a})` : ""); });
  const n = ch.elements.length - ch.centre.length;
  const parts = [n ? `It shows ${list(named, { max: 3 })} and the ${count(n, "part")} ${verb(ch.centre.length, "it connects", "they connect")} to` : `It shows ${list(named, { max: 3 })}, which ${verb(ch.centre.length, "has", "have")} no relationships`];
  const lines = [ch.removedRelationships.length ? `the ${count(ch.removedRelationships.length, "relationship")} the patch removes ${verb(ch.removedRelationships.length, "is", "are")} dashed red` : "", ch.addedRelationships.length ? `the ${count(ch.addedRelationships.length, "relationship")} it adds ${verb(ch.addedRelationships.length, "is", "are")} green` : ""].filter(Boolean);
  if (lines.length) parts.push(lines.join(", and "));
  const more = ch.more.reduce((t, m) => t + m.count, 0);
  if (more) parts.push(`Another ${count(more, "neighbour")} ${verb(more, "is", "are")} left out: ${list(ch.more.map((m) => `${fmt(m.count)} in ${m.zone ? ix.zone.get(m.zone) ?? m.zone : "no zone"}`), { max: 3 })}`);
  return para(parts);
}

/** Every curated view the patch changes, as a table: what each one loses and gains. */
function viewChangeTable(ix: Ix, p: Patch & { impact: Impact }): string {
  const vs = p.impact.drawing?.views ?? [];
  if (!vs.length) return "";
  const cell = (rem: number, add: number) => [rem ? `<span class="sym rem" aria-hidden="true">&#8722;</span>${fmt(rem)}<span class="sr-only"> removed</span>` : "", add ? `<span class="sym add" aria-hidden="true">+</span>${fmt(add)}<span class="sr-only"> added</span>` : ""].filter(Boolean).join(" ") || `<span class="muted">·</span>`;
  const row = (v: (typeof vs)[number]) => {
    const what = [...v.elementsRemoved.map((id) => nameOf(ix, p.impact, "element", id)), ...v.elementsAdded.map((id) => nameOf(ix, p.impact, "element", id))];
    return `<tr><td class="lead" data-label="View">${ix.view.has(v.view) ? `<a href="${route.view(v.view)}">${esc(v.title)}</a>` : esc(v.title)}</td><td class="inline n" data-label="Parts">${cell(v.elementsRemoved.length, v.elementsAdded.length)}</td><td class="inline n" data-label="Relationships">${cell(v.relationshipsRemoved.length, v.relationshipsAdded.length)}</td>${showWhat ? `<td class="inline small fg2" data-label="">${esc(list(what, { max: 2 }))}</td>` : ""}</tr>`;
  };
  const whats = new Set(vs.map((v) => [...v.elementsRemoved, "|", ...v.elementsAdded].join(" ")));
  const showWhat = whats.size > 1;
  const head = `<thead><tr><th scope="col">View</th><th scope="col">Parts</th><th scope="col">Relationships</th>${showWhat ? `<th scope="col">Which parts</th>` : ""}</tr></thead>`;
  const first = vs.slice(0, 8), rest = vs.slice(8);
  return `<h4 class="small fg2" style="margin-top:var(--sp-4)">Views this changes <span class="muted">${vs.length}</span></h4>
<div class="table-wrap reflow"><table class="reflow vchg">${head}<tbody>${first.map(row).join("")}</tbody></table></div>${rest.length ? `<details class="disc"><summary>${esc(`Show ${count(rest.length, "more view")}`)}</summary><div class="body" style="padding-left:0"><div class="table-wrap reflow"><table class="reflow vchg">${head}<tbody>${rest.map(row).join("")}</tbody></table></div></div></details>` : ""}`;
}

/** A unit a patch touches, as a row: its title, its owner team (up to two), its milestone and its state. */
function affectedRow(ix: Ix, id: string): string {
  const u = ix.unit.get(id);
  if (!u) return `<li><span class="muted" title="${esc(id)}">A unit no longer in the plan</span></li>`;
  const o = ownersOf(ix, u).map((t) => ix.team.get(t) ?? t);
  const who = !o.length ? "needs an owner" : o.length <= 2 ? o.join(", ") : `no clear owner (${o.length} teams)`;
  return `<li class="work-row">${unitLink(ix, id)}<span class="xs fg2 work-meta">${esc(who)} · ${esc(gateLabel(ix, u.phase))}</span></li>`;
}

function changeSection(ix: Ix, p: Patch & { impact: Impact }): string {
  const dr = p.impact.drawing!;
  const merged = !!dr.change;
  const ctrl = merged ? `<div class="seg" role="group" aria-label="Show" data-ba-mode hidden><button type="button" class="btn" data-mode="change" aria-pressed="true">Change</button><button type="button" class="btn" data-mode="before" aria-pressed="false">Before</button><button type="button" class="btn" data-mode="after" aria-pressed="false">After</button></div>` : "";
  return `<section class="patch-sec"><div class="section-head"><h3>${merged ? "The change, drawn" : "Before and after"}</h3>${ctrl}</div><p class="small fg2 reading" style="margin-bottom:var(--sp-2)">${esc(changeCaption(ix, p))}</p><div class="ba${merged ? " merged" : ""}" data-ba="${esc(p.id)}"><noscript><p class="empty">The drawing needs JavaScript; the table below lists every view it changes.</p></noscript></div>${viewChangeTable(ix, p)}</section>`;
}

/** A short stable hash of a patch's content, for "changed since you reviewed it". */
export function patchHash(p: Patch): string {
  const s = JSON.stringify({ t: p.title, s: p.status, w: p.why, o: p.ops });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

function changes(ix: Ix): string {
  const b = ix.b;
  const patches = [...b.patches].sort((a, c) => natural(a.id, c.id));
  const list = patches.map((p) => {
    const v = verdict(p);
    const pv = p.provenance;
    return `<a class="list-row" href="${route.patch(p.id)}" data-patch-row="${esc(p.id)}" data-status="${esc(p.status)}">${icon(v.cls, "icon st-" + v.cls)}<span class="t"><span class="id">${esc(p.id)}</span> ${esc(p.title)}</span>
<span class="meta"><span class="tag ${p.status === "accepted" ? "success" : p.status === "rejected" ? "" : "accent"}">${esc(PATCH_LABEL[p.status] ?? p.status)}</span><span>${esc(v.short)}</span>${pv ? (pv.author === "agent" || pv.agent ? `<span class="tag agent">${icon("agent", "icon icon-sm")}Agent-written</span>` : `<span>By ${esc(proposer(pv)!.who)}</span>`) : ""}${pv?.created ? `<time class="muted" datetime="${esc(pv.created)}" data-age>${esc(pv.created)}</time>` : ""}</span></a>`;
  }).join("");
  const proposed = patches.filter((p) => p.status === "proposed").length;
  return `<section class="page" id="changes" data-page="changes" aria-labelledby="h-changes">
<div class="page-head"><h1 id="h-changes" tabindex="-1">Changes</h1><p class="muted">${plural(patches.length, "change")} · ${proposed} proposed</p></div>
${patches.length ? `<div class="changes-layout" id="changes-layout"><div class="changes-list"><div class="chipbar" id="patch-filter" role="group" aria-label="Show changes" style="margin-bottom:var(--sp-2)" hidden>
${["proposed", "accepted", "rejected", "all"].map((s) => `<button type="button" class="fchip" data-pf="${s}" aria-pressed="${s === "proposed" && proposed ? "true" : s === "all" && !proposed ? "true" : "false"}">${s === "all" ? "All" : PATCH_LABEL[s]}</button>`).join("")}</div>
<p class="small filter-line" id="patch-filtered" hidden></p><nav class="panel patch-list" aria-label="Changes">${list}</nav><p class="empty" id="patch-none" hidden style="margin-top:8px">No changes with this status.</p></div>
<div class="patch-details" id="patch-details">${patches.map((p) => patchDetail(ix, p)).join("")}</div></div>` : `<p class="empty">No patches. A change to the model is a file in <code>patches/</code>, written by a person or an agent and reviewed here.</p>`}
${comparisonsSection(b)}
</section>`;
}

/**
 * A design page built inside a portfolio (bundle.portfolio): a bar under the header that says which view this is
 * (working copy, or the released edition with today's status), links back to the portfolio's page and to the other
 * designs' pages. A lone page and a design's own page have none of it.
 */
function portfolioBar(b: Bundle): string {
  const p = b.portfolio;
  if (!p) return "";
  const presenting = p.mode === "presenting";
  const head = presenting ? "Presenting released editions" : "Working copy";
  const others = p.designs.filter((d) => d.namespace !== p.namespace);
  return `<div class="pf-ctx in-header${presenting ? " presenting" : ""}" role="note" aria-label="Where this page sits"><div class="inner"><a class="pf-back" href="${esc(p.href)}">${icon("back", "icon icon-sm")}${esc(p.title)}</a><span class="tag${presenting ? " accent" : ""} pf-mode-tag">${esc(head)}</span><span class="pf-ctx-line">${esc(p.modeLine.startsWith(`${head} · `) ? p.modeLine.slice(head.length + 3) : p.modeLine)}</span>${others.length ? `<span class="pf-others">Other designs: ${others.map((d) => `<a href="${esc(d.href)}">${esc(d.title)}</a>`).join("")}</span>` : ""}</div></div>`;
}

/** Render the whole site. Pure: same bundle in, same string out. */
export function renderSite(bundle: Bundle): string {
  const ix = index(bundle);
  const b = bundle;
  const desc = b.instance.description ?? `Plumb site for ${b.instance.title}`;
  return `<!doctype html>
<html lang="en"${b.portfolio ? ` class="in-pf"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(desc)}">
<meta name="generator" content="Plumb ${esc(b.engine?.version ?? "")}">
<title>${esc(b.instance.title)}</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}${b.portfolio ? PORTFOLIO_CSS : ""}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${SPRITE()}
${b.portfolio ? header(ix).replace(/<\/header>$/, `${portfolioBar(b)}</header>`) : header(ix)}
${nav(ix)}
<main id="main" tabindex="-1">
${overview(ix)}
${model(ix)}
${plan(ix)}
${checks(ix)}
${changes(ix)}
${b.tracker ? trackerPage(b, { unitLink: (id) => unitLink(ix, id), status, icon, gateLabel: (id) => gateLabel(ix, id), route }) : ""}
${b.model.claims?.length ? strategyPage(b) : ""}
${teamsPage(b)}
${notesPage(b)}
</main>
${presentSection(b)}
<div id="live" class="sr-only" aria-live="polite" aria-atomic="true"></div>
<div id="toast" class="toast" role="status" hidden><span id="toast-text"></span><a id="toast-link" href="#notes" hidden></a><button type="button" id="toast-close" aria-label="Dismiss">${icon("close", "icon icon-sm")}</button></div>
<script type="application/json" id="de-bundle">${inlineJson(b)}</script>
<script>${inlineScript(CLIENT_JS)}</script>
</body>
</html>
`;
}

export default renderSite;
