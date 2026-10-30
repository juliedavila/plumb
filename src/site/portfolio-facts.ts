// The portfolio page's facts: everything the page reads beyond the portfolio's data, assembled
// once at build time from the run (src/core/portfolio.ts), its designs' bundles and its root.
//
//   - the mode words: which view this is, working copies or released editions with today's status;
//   - the roadmap: a row per design, its milestones in their target months, the capacity each brings back, and the
//     units that wait on another design's work, as sentences;
//   - the seams as sentences: sides, owner team, crossings with their marks, exceptions, what nothing declares;
//     a design's edges to a shared part that no seam names are grouped under that part, so nothing undeclared hides;
//   - every org number with its provenance, age, trend, measured value, gap and pending proposal;
//   - the root's patches, proposed ones with the portfolio's verdict and effect;
//   - the findings with names where the messages have ids;
//   - the focus across designs: the client's own focusFacts, run per design over its bundle exactly as the design
//     page runs it, merged by design. The page applies the merged facts; nothing here is computed twice.
// Nothing here changes a file. The page's render (src/site/portfolio.ts) is a pure function of the result.

import type {
  Bundle, CrossingJudgement, CrossWait, EstimateFacts, EstimateRow, Finding, ModeWords, OrgView, PortfolioContext, PortfolioData,
  PortfolioDesignLink, PortfolioFocusFacts, PortfolioFocusOption, PortfolioImpact, PortfolioMode, PortfolioPageFacts, RoadmapMilestone,
  RoadmapRow, RootPatchView, SeamCrossingView, SeamExceptionView, SeamPageView, Team,
} from "../types.ts";
import type { PortfolioRun } from "../core/portfolio.ts";
import { ENGINE_GLOSSARY, GLOSSARY_04, defaultForms } from "../core/glossary.ts";
import { loadPacks } from "../core/rules.ts";
import { recordNames, nameIds, claimShort, readerUnitTitle } from "../core/reader.ts";
import { ORG, parseRef, SHARED } from "../core/namespace.ts";
import { ownerTeams } from "../core/teams.ts";
import { natCompare } from "../core/util.ts";
import { count, fmt, list, quote, sentence } from "./prose.ts";
import { CLIENT_JS } from "./render.ts";

type Raw = Record<string, unknown>;

// ---------- words ----------

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "30 Oct", or "30 Oct 2027" when the year is not the build's. */
export function shortDay(iso: string | undefined, today?: string): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const d = `${Number(m[3])} ${MON[Number(m[2]) - 1]}`;
  return today && today.slice(0, 4) === m[1] ? d : `${d} ${m[1]}`;
}
/** "Nov 2026" for a month column. */
export const monthWords = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const possessive = (t: string) => (/s$/i.test(t) ? `${t}'` : `${t}'s`);
const num = (x: number) => fmt(Math.round(x * 100) / 100);
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const slots = (x: number) => `${num(x)} ${Math.abs(x - 1) < 1e-9 ? "slot" : "slots"}`;
/** A namespaced id without its namespace: "shared:ProvenClass" -> "ProvenClass". */
export const bare = (id: string) => { const r = parseRef(id); return r.ns ? r.id : id; };
/** The namespace a composed id names, or "" for a bare one. */
const nsOf = (id: string) => parseRef(id).ns ?? "";
const ym = (d: string) => d.slice(0, 7);
function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** The words for an engine signal on a crossing, plainly. */
const SIGNAL_WORDS: Record<string, string> = {
  "agent-reach": "it reaches a part coding agents can reach",
  "untrusted-content": "it carries content anyone may have written",
  "untrusted-fields": "its contract has fields anyone may have written",
  "evidence-partitioned": "it carries evidence into a store kept apart",
  "grants-authority": "it ends at a part that grants authority",
  "model-boundary": "it crosses into a model",
};
/** A rule code a shipped floor names, as words: "agent-input" -> "agent input". */
const codeWords = (c: string) => c.replace(/^[a-z]+\//, "").replace(/[-_.]+/g, " ").trim();

// ---------- the mode ----------

/** How a design is labelled on a page of this mode. */
export function designLabel(d: Pick<PortfolioData["designs"][number], "title" | "edition" | "editionDate" | "sinceRelease">, mode: PortfolioMode, today?: string): string {
  if (d.edition) return `${d.title} ${d.edition}${d.editionDate ? ` (${shortDay(d.editionDate, today)})` : ""}`;
  if (mode === "presenting") return `${d.title}: no released edition; working copy shown`;
  const sr = d.sinceRelease;
  return `${d.title}: working copy${sr ? `, ${sr.accepted_patches ? count(sr.accepted_patches, "accepted patch", "accepted patches") : "no accepted patches"} since ${sr.version}` : ""}`;
}

/** The page's mode words: the head and the line under the header. */
export function modeWords(mode: PortfolioMode, today: string): ModeWords {
  return mode === "presenting"
    ? { mode, head: "Presenting released editions", line: `Presenting released editions · each design's newest released edition, with today's status · status as of ${shortDay(today, today)}` }
    : { mode, head: "Working copy", line: `Working copy · each design as it stands now, accepted patches included · as of ${shortDay(today, today)}` };
}

/** The line a design page built inside the portfolio carries under its header. */
export function designModeLine(mode: PortfolioMode, label: string, today: string): string {
  return mode === "presenting" ? `Presenting released editions · ${label} · status as of ${shortDay(today, today)}` : `Working copy · ${label}`;
}

// ---------- the focus across designs ----------

interface ClientApi {
  buildIndex(b: Bundle): any; focusOptions(ix: any): { teams: { kind: string; id: string; name: string }[]; leads: { kind: string; id: string; name: string }[] };
  focusFacts(ix: any, f: { kind: string; id: string }): any; focusRelWords(ix: any, rels: unknown): string; focusShareWords(ff: any, phaseId: string): string; leadKey(s: unknown): string;
}
let CLIENT: ClientApi | undefined;
/** The page's own client functions, loaded without a DOM, so the focus means here exactly what it means on a design page. */
export function client(): ClientApi {
  CLIENT ??= new Function(`${CLIENT_JS}\nreturn DE;`)() as ClientApi;
  return CLIENT;
}

/** A design-local team as the portfolio names it ("<ns>:<id>"); an org team keeps its "org:<id>". */
const teamRef = (ns: string, id: string) => (parseRef(id).ns ? id : `${ns}:${id}`);

/** Who the portfolio can focus on: every org team (and each design's own teams), and every distinct lead across the org layer and every design. */
export function portfolioFocusOptions(designs: { ns: string; bundle: Bundle }[], orgTeams: Team[]): { teams: PortfolioFocusOption[]; leads: PortfolioFocusOption[] } {
  const C = client();
  const teams = new Map<string, PortfolioFocusOption>();
  for (const t of orgTeams) teams.set(`${ORG}:${t.id}`, { kind: "team", id: `${ORG}:${t.id}`, name: t.name || t.id });
  const leads = new Map<string, PortfolioFocusOption>();
  const addLead = (s: unknown) => { const k = C.leadKey(s); if (k && !leads.has(k)) { const t = String(s).replace(/\s+/g, " ").trim(); leads.set(k, { kind: "lead", id: k, name: t.charAt(0).toUpperCase() + t.slice(1) }); } };
  for (const t of orgTeams) addLead(t.lead);
  for (const { ns, bundle } of designs) {
    const o = C.focusOptions(C.buildIndex(bundle));
    for (const t of o.teams) { const id = teamRef(ns, t.id); if (!teams.has(id)) teams.set(id, { kind: "team", id, name: t.name }); }
    for (const l of o.leads) if (!leads.has(l.id)) leads.set(l.id, { kind: "lead", id: l.id, name: l.name });
  }
  return { teams: [...teams.values()], leads: [...leads.values()].sort((a, b) => natCompare(a.name, b.name)) };
}

/**
 * One focus across the designs: focusFacts per design over its bundle, merged by design into composed ids. A lead's
 * teams are every team the org layer and the designs say they lead; a shared part counts as theirs when the root's team
 * map gives its owner role to one of their teams.
 */
export function portfolioFocusFacts(focus: PortfolioFocusOption, designs: { ns: string; bundle: Bundle }[], opts: { orgTeams?: Team[]; sharedParts?: Record<string, string[]>; findings?: { key: string; subject: string; design?: string }[]; ends?: Record<string, string[]>; teamOf?: Record<string, string> } = {}): PortfolioFocusFacts {
  const C = client();
  const out: PortfolioFocusFacts = { kind: focus.kind, id: focus.id, name: focus.name, teams: [], units: {}, waiting: [], parts: [], milestones: {}, designs: {}, findings: [] };
  const teams = new Set<string>();
  if (focus.kind === "team") teams.add(focus.id);
  else for (const t of opts.orgTeams ?? []) if (C.leadKey(t.lead) === focus.id) teams.add(`${ORG}:${t.id}`);
  const parts = new Set<string>(), waiting = new Set<string>();
  for (const { ns, bundle } of designs) {
    const ix = C.buildIndex(bundle);
    // the focus as this design's page holds it: an org team by its own id, a design's own team bare
    const local = focus.kind === "team" ? { kind: "team", id: parseRef(focus.id).ns === ns ? parseRef(focus.id).id : focus.id } : { kind: "lead", id: focus.id };
    const ff = C.focusFacts(ix, local);
    for (const t of ff.teams as string[]) teams.add(teamRef(ns, t));
    let units = 0, ms = 0;
    (ff.units as Map<string, unknown>).forEach((rels, id) => { out.units[`${ns}:${id}`] = C.focusRelWords(ix, rels); units++; });
    (ff.waiting as Map<string, unknown>).forEach((_v, id) => waiting.add(`${ns}:${id}`));
    (ff.parts as Map<string, unknown>).forEach((_v, id) => parts.add(parseRef(id).ns ? id : `${ns}:${id}`));
    (ff.phases as Map<string, { units?: string[]; theirs?: number; total?: number }>).forEach((p, id) => {
      const n = (p.units ?? []).length;
      const open = (p.units ?? []).filter((u) => ix.unit.get(u)?.status !== "done").length;
      const openAll = ((ix.unitsOfPhase?.get(id) ?? []) as string[]).filter((u) => ix.unit.get(u)?.status !== "done").length;
      const units = !n ? "They lead it." : !open ? sentence(`Their ${n === 1 ? "unit here is" : `${fmt(n)} units here are`} done`)
        : open === openAll ? (open === 1 ? "Its one open unit is theirs." : `All ${fmt(open)} of its open units are theirs.`)
        : sentence(`${fmt(open)} of its ${count(openAll, "open unit")} ${open === 1 ? "is" : "are"} theirs`);
      out.milestones[`${ns}:${id}`] = p.total ? `${units} ${C.focusShareWords(ff, id)}` : units; ms++;
    });
    if (units || ms) out.designs[ns] = { units, milestones: ms };
  }
  for (const [part, owners] of Object.entries(opts.sharedParts ?? {})) if (owners.some((t) => teams.has(t))) parts.add(part);
  out.teams = [...teams].sort(natCompare);
  out.parts = [...parts].sort(natCompare);
  out.waiting = [...waiting].sort(natCompare);
  // a finding is theirs when its record is: a unit or a part of theirs, their team, a crossing or relationship one of
  // whose ends is theirs (as a design page's focusFacts counts a relationship's finding), an org record on their team
  const mine = (subject: string) => subject in out.units || parts.has(subject) || teams.has(subject)
    || (opts.ends?.[subject] ?? []).some((e) => parts.has(e)) || (!!opts.teamOf?.[subject] && teams.has(opts.teamOf[subject]));
  out.findings = (opts.findings ?? []).filter((f) => mine(f.subject)).map((f) => f.key);
  return out;
}

// ---------- the facts ----------

export interface PageFactsOptions {
  built: string;                         // the build time; its date is "today"
  impacts?: PortfolioImpact[];           // the root's proposed patches with their portfolio verdicts
  hrefOf?: (ns: string) => string;       // a design's page, relative to the portfolio page (default "<ns>/index.html")
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** "Three designs", "12 designs": a count spelled out up to twelve, for the start of a sentence and its small numbers. */
export const said = (n: number, one: string, many?: string) => `${WORDS[n] ?? fmt(n)} ${n === 1 ? one : many ?? `${one}s`}`;

/** The page's opening sentence: each clause only when it holds. */
export function openingSentence(data: PortfolioData, undeclared: { relevant: number; excepted: number }): string {
  const L = data.load;
  const designs = data.designs.length;
  const out: string[] = [];
  const nTeams = L?.teams.length ?? 0;
  out.push(sentence(`${cap(said(designs, "design"))} ${nTeams ? `share ${said(nTeams, "team")}` : designs === 1 ? "is composed" : "are composed"}`));
  if (L?.contended) out.push(L.contended.text);
  const over = L?.counts.over ?? 0;
  if (over) out.push(sentence(`${cap(said(over, "team"))} ${over === 1 ? "is" : "are"} over capacity`));
  const n = undeclared.relevant;
  if (n) out.push(sentence(`${cap(said(n, "crossing"))} ${n === 1 ? "is" : "are"} undeclared and security-relevant${undeclared.excepted ? `; ${undeclared.excepted === n ? (n === 1 ? "an exception makes it a warning for now" : "exceptions make them warnings for now") : `an exception makes ${said(undeclared.excepted, "of them", "of them")} a warning for now`}` : ""}`));
  const running = L?.counts.slowdownsRunning ?? 0;
  if (running) out.push(sentence(`${cap(said(running, "slowdown bet"))} ${running === 1 ? "is" : "are"} running`));
  const errors = data.findings.filter((f) => f.severity === "error").length;
  if (!L && errors) out.push(sentence(`The checks report ${count(errors, "error")}`));
  return out.join(" ");
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything the page reads beyond the portfolio's data. */
export async function portfolioPageFacts(run: PortfolioRun, opts: PageFactsOptions): Promise<PortfolioPageFacts> {
  const data = run.data;
  const today = /^\d{4}-\d{2}-\d{2}/.test(opts.built) ? opts.built.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const mode = data.portfolio.mode;
  const hrefOf = opts.hrefOf ?? ((ns: string) => `${encodeURIComponent(ns)}/index.html`);
  const L = data.load;
  const org: OrgView | undefined = run.rootCheck?.check.org;
  const root = run.root;
  const designs = run.designs.filter((d) => d.composed && d.bundle).map((d) => ({ ns: d.namespace, run: d, bundle: d.bundle! }));
  const words = data.designs;
  const titleOf = (ns: string) => (ns === SHARED ? "the shared layer" : ns === ORG ? "the org layer" : words.find((d) => d.namespace === ns)?.title ?? ns);

  // names for composed ids: the composed graph's records, and the org layer's
  const capabilities = root.shared?.capabilities ?? [];
  const names = run.graph ? recordNames(run.graph.model, run.graph.plan, { capabilities }) : { byKind: new Map(), any: new Map() };
  const orgName = new Map<string, string>();
  for (const t of org?.teams ?? []) orgName.set(`${ORG}:${t.id}`, t.name);
  for (const a of org?.activities ?? []) orgName.set(`${ORG}:${a.id}`, a.name);
  const activityOf = new Map((org?.activities ?? []).map((a) => [`${ORG}:${a.id}`, a]));
  for (const s of org?.slowdowns ?? []) orgName.set(`${ORG}:${s.id}`, `the slowdown of ${quote(activityOf.get(`${ORG}:${s.activity}`)?.name ?? s.activity)}`);
  const el = new Map((run.graph?.model.elements ?? []).map((e) => [e.id, e]));
  const unitOf = new Map((run.graph?.plan.units ?? []).map((u) => [u.id, { ...u, title: readerUnitTitle(u, capabilities) }]));
  const phaseOf = new Map((run.graph?.plan.phases ?? []).map((p) => [p.id, p]));
  const plainName = (id: string): string => {
    if (orgName.has(id)) return orgName.get(id)!;
    const e = el.get(id); if (e) return e.name;
    const u = unitOf.get(id); if (u) return quote(u.title);
    const p = phaseOf.get(id); if (p) return quote(p.name);
    const t = run.graph?.model.teams.find((x) => x.id === id); if (t) return t.name;
    const r = run.graph?.model.relationships.find((x) => x.id === id); if (r) return `${el.get(r.from)?.name ?? bare(r.from)} → ${el.get(r.to)?.name ?? bare(r.to)}`;
    return bare(id);
  };
  // ── the seams ──
  const canonTeam = (t: string) => (root.org && !parseRef(t).ns ? `${ORG}:${t}` : t);
  const teamName = (t: string) => orgName.get(t) ?? run.graph?.model.teams.find((x) => x.id === t)?.name ?? bare(t);
  const ownersOf = (role?: string) => (role ? ownerTeams(root.teamMap, role).map(canonTeam).map((id) => ({ id, name: teamName(id) })) : []);
  const sharedParts: Record<string, string[]> = {};
  for (const p of root.shared?.parts ?? []) if (p.owner) sharedParts[`${SHARED}:${p.id}`] = ownerTeams(root.teamMap, p.owner).map(canonTeam);
  const milestoneWords = (ref: string | undefined): string => {
    if (!ref) return "no end";
    if (/^\d{4}-\d{2}-\d{2}/.test(ref)) return shortDay(ref, today);
    const p = phaseOf.get(ref);
    return p ? `${possessive(titleOf(nsOf(ref)))} ${quote(p.name)}${(p as { target?: string }).target ? ` (target ${shortDay((p as { target?: string }).target, today)})` : ""}` : bare(ref);
  };
  const endName = (id: string) => {
    const e = el.get(id);
    const n = e?.name ?? bare(id);
    const ns = nsOf(id);
    if (ns === SHARED) return `${n} (shared)`;
    return ns ? `${possessive(titleOf(ns))} ${n}` : n;
  };
  const markWhy = (c: CrossingJudgement): string => {
    const m = c.mark;
    if (!m) return "No mark could be computed for it, so it counts as security-relevant.";
    const parts: string[] = [];
    if (m.floor.length) parts.push(m.floor_source === "shipped" ? `the shipped checks mark it (${m.floor.map(codeWords).join(", ")})` : `the engine's checks mark it: ${list(m.floor.map((s) => SIGNAL_WORDS[s] ?? codeWords(s)))}`);
    if (m.raised) parts.push(`raised by ${m.raised.by ?? "someone not named"}${m.raised.why ? `: ${m.raised.why.replace(/[.\s]+$/, "")}` : ""}`);
    if (!parts.length) return m.relevant ? "Security-relevant." : "Not security-relevant: no check reads it, and nobody raised it.";
    return sentence(`${m.relevant ? "Security-relevant" : "Not security-relevant"}: ${parts.join("; ")}`);
  };
  const crossingView = (c: CrossingJudgement): SeamCrossingView => {
    const what = c.label ? quote(c.label) : c.carries.map(bare).join(" and ") || "a relationship";
    const oneDesign = nsOf(c.from) === nsOf(c.to) && nsOf(c.from) !== SHARED;
    const head = oneDesign ? `${possessive(titleOf(nsOf(c.from)))} ${el.get(c.from)?.name ?? bare(c.from)} sends ${what} to ${el.get(c.to)?.name ?? bare(c.to)}` : `${endName(c.from)} sends ${what} to ${endName(c.to)}`;
    const ex = c.exception;
    return {
      id: c.id, relevant: c.mark ? c.mark.relevant : true, why: markWhy(c), carries: c.carries.map(bare), ends: [c.from, c.to], declared: c.declared,
      text: sentence(c.declared ? head : `${head}, and nothing declares it`),
      ...(c.severity ? { severity: c.severity } : {}),
      ...(ex ? { excepted: sentence(`An exception accepted by ${ex.accepted_by ? plainName(ex.accepted_by) : "someone not named"} until ${milestoneWords(ex.until)} makes it a warning`) } : {}),
    };
  };
  const exceptionView = (x: PortfolioData["seams"]["seams"][number]["exceptions"][number]): SeamExceptionView => {
    const untilText = milestoneWords(x.until);
    const contracts = x.contracts.map(bare);
    const state = x.state === "in force" ? "in force" : x.state === "ended" ? "ended" : "not applied";
    const acceptedBy = x.accepted_by ? plainName(x.accepted_by) : undefined;
    const text = [
      sentence(`${x.source === "org" ? "The organization's exception" : "The shipped exception"} flags ${list(contracts)} as a warning ${x.state === "ended" ? "until it ended at" : "until"} ${untilText}`),
      sentence(`Accepted by ${acceptedBy ?? "nobody named"}`),
      state === "not applied" ? sentence(`Not applied: ${x.problems.join(". ") || "it is not valid"}`) : "",
    ].filter(Boolean).join(" ");
    return { contracts, ...(acceptedBy ? { acceptedBy } : {}), ...(x.until ? { until: x.until } : {}), untilText, ...(x.why ? { why: x.why } : {}), source: x.source, state, text };
  };
  // every id a message may print beside a record's name: composed, and bare for a design's own records; org ids
  const knownIds = new Set<string>();
  for (const x of [...(run.graph?.model.elements ?? []), ...(run.graph?.model.relationships ?? []), ...(run.graph?.model.teams ?? []), ...(run.graph?.plan.units ?? []), ...(run.graph?.plan.phases ?? [])]) { knownIds.add(x.id); knownIds.add(bare(x.id)); }
  for (const id of orgName.keys()) { knownIds.add(id); knownIds.add(bare(id)); }
  // org ids named whole, never inside a longer id: the longest first, bounded on both sides
  const reEscape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
  const orgIdPattern = orgName.size ? new RegExp(`(?<![A-Za-z0-9_.:-])(?:${[...orgName.keys()].sort((a, b) => b.length - a.length).map(reEscape).join("|")})(?![A-Za-z0-9_-])`, "g") : /$^/g;
  /** A finding's message as a reader sees it: names where it has ids, the namespaced id beside a name dropped. */
  const readerText = (f: Finding & { design?: string; subject?: string }) => {
    if (f.pack === "portfolio" && f.rule === "seam-crossing-declared" && f.subject) {
      const c = data.seams.crossings.find((x) => x.id === f.subject);
      if (c) { const v = crossingView(c); return [v.text, v.why, v.excepted].filter(Boolean).join(" "); }
    }
    let t = f.text ?? f.message;
    if (f.rule === "xref-pin-stale" && f.design) t = t.replace(new RegExp(`^${f.design} pins `), `${titleOf(f.design)} pins `).replace(/([^.])$/, "$1.");
    t = nameIds(t, names);
    // "Vulnerability management (org:vuln-mgmt)", "Check runner (check-runner)": the id beside its name, said once
    t = t.replace(/ \(([^()\s]+)\)/g, (all, id: string) => (knownIds.has(id) ? "" : all));
    t = t.replace(orgIdPattern, (id) => orgName.get(id) ?? id);
    // config keys a rule names, in words (the key stays in the message and in portfolio.json)
    t = t.replace(/older than estimates\.stale_after_days \((\d+)\)/g, "older than the $1 days an estimate stays current");
    return t;
  };

  // ── the designs and the mode ──
  const modeW = modeWords(mode, today);
  const links: PortfolioDesignLink[] = words.map((d) => ({ namespace: d.namespace, title: d.title, href: hrefOf(d.namespace), label: designLabel(d, mode, today) }));

  // ── the roadmap ──
  const horizon = data.portfolio.horizon_months && data.portfolio.horizon_months > 0 ? Math.floor(data.portfolio.horizon_months) : 12;
  const months = Array.from({ length: horizon }, (_v, i) => addMonths(ym(today), i));
  const lastMonth = months[months.length - 1];
  // reliefs still to land, by the milestone that brings them: each against the share as written, so a slowdown that
  // happens to hold the share lower meanwhile does not hide what the relief brings back for good
  const reliefsAt = new Map<string, RoadmapMilestone["reliefs"]>();
  for (const a of L?.activities ?? []) {
    const t = L!.teams.find((x) => x.team === a.team);
    let level = a.share ?? a.now;
    for (const r of a.reliefs.filter((x) => x.landed)) level = Math.min(level, r.to);
    const open = a.reliefs.filter((x) => !x.landed && x.kind !== "unknown").sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"));
    for (const r of open) {
      const after = Math.min(level, r.to);
      const freed = t?.capacity !== undefined ? (level - after) * t.capacity : undefined;
      level = after;
      const ms = r.kind === "milestone" ? r.at : r.milestone;
      if (!ms) continue;
      const ev = [...(t?.timeline.steps.flatMap((x) => x.events) ?? []), ...(t?.timeline.undated ?? [])].find((e) => e.kind === "relief" && e.at === r.at && e.activity === a.activity);
      const list0 = reliefsAt.get(ms) ?? [];
      list0.push({ team: a.team, teamName: a.teamName, activity: a.activity, activityName: a.name, ...(freed !== undefined ? { slots: Math.round(freed * 100) / 100 } : {}), landed: false, ifOnTarget: !!r.date, text: ev?.text ?? sentence(`${quote(a.name)} ${r.effect === "retire" ? "ends" : `falls to ${pct(r.to)}`} with ${r.name ? quote(r.name) : bare(r.at)}`) });
      reliefsAt.set(ms, list0);
    }
  }
  const providers = new Map<string, string[]>();
  for (const u of run.graph?.plan.units ?? []) for (const c of u.provides ?? []) providers.set(c, [...(providers.get(c) ?? []), u.id]);
  let noDate = false;
  const rows: RoadmapRow[] = designs.map(({ ns, bundle }) => {
    const w = words.find((d) => d.namespace === ns)!;
    const st = new Map((bundle.status?.milestones ?? []).map((m) => [m.phase, m]));
    const stats = new Map((bundle.analysis?.phases ?? []).map((p) => [p.id, p]));
    const phases = [...bundle.plan.phases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || natCompare(a.id, b.id));
    const milestones: RoadmapMilestone[] = phases.map((p) => {
      const s = st.get(p.id), a = stats.get(p.id);
      const total = a?.total ?? bundle.plan.units.filter((u) => u.phase === p.id).length;
      const done = a?.done ?? bundle.plan.units.filter((u) => u.phase === p.id && u.status === "done").length;
      const reached = s?.reached ?? (a ? a.complete : total > 0 && done === total);
      const target = p.target && /^\d{4}-\d{2}-\d{2}/.test(p.target) ? p.target.slice(0, 10) : undefined;
      const late = !!target && !reached && target < today;
      const beyond = !!target && !reached && ym(target) > lastMonth;
      const month = target && !reached && !beyond ? ym(target) : undefined;
      if (!target) noDate = true;
      const id = `${ns}:${p.id}`;
      const why = s?.reasons?.[0];
      const m: RoadmapMilestone = {
        id, design: ns, name: p.name, ...(target ? { target } : {}), ...(month ? { month } : {}), ...(late ? { late } : {}), ...(beyond ? { beyond } : {}),
        ...(s ? { status: s.status, ...(why ? { statusWhy: why.short ?? why.text } : {}), ...(s.override ? { manual: true } : {}) } : {}),
        reached, current: !!s?.current, ...(p.delivers ? { delivers: p.delivers } : {}), ...(p.lead ? { lead: p.lead } : {}),
        open: total - done, total, reliefs: reliefsAt.get(id) ?? [],
        href: `${hrefOf(ns)}#plan/milestone/${encodeURIComponent(p.id)}`,
      };
      return m;
    });
    // its open units waiting on another design's units, through capabilities
    const waits: CrossWait[] = [];
    for (const u of run.graph?.plan.units ?? []) {
      if (nsOf(u.id) !== ns || u.status === "done") continue;
      for (const c of u.requires ?? []) for (const pid of providers.get(c) ?? []) {
        const other = nsOf(pid);
        if (!other || other === ns) continue;
        const pu = unitOf.get(pid)!;
        const done = pu.status === "done";
        const title = readerUnitTitle(u, capabilities);
        waits.push({ unit: u.id, title, design: ns, on: pid, onTitle: pu.title, onDesign: other, capability: c, done,
          text: sentence(`${possessive(titleOf(ns))} ${quote(title)} ${done ? "waited on" : "waits on"} ${possessive(titleOf(other))} ${quote(pu.title)}${done ? ", which is done" : ""}`) });
      }
    }
    const units = bundle.plan.units.length, doneUnits = bundle.plan.units.filter((u) => u.status === "done").length;
    return {
      design: ns, title: w.title, label: designLabel(w, mode, today), href: hrefOf(ns), ...(w.edition ? { edition: w.edition } : {}),
      ...(bundle.status ? { status: bundle.status.overall.status, statusText: bundle.status.overall.lead?.text ?? bundle.status.overall.text } : {}),
      counts: { ...w.counts, units, done: doneUnits }, milestones, waits,
    };
  });

  const cj = new Map(data.seams.crossings.map((c) => [c.id, c]));
  const page0Seam = (ref: string) => data.seams.seams.find((s) => s.key === bare(ref) || s.key === ref)?.name;
  const order = (a: SeamCrossingView, b: SeamCrossingView) => Number(b.relevant) - Number(a.relevant) || natCompare(a.id, b.id);
  const ruleTitles = await ruleTitleMap(run);
  const seams: SeamPageView[] = data.seams.seams.map((s) => {
    const sides = s.kind === "module" ? [`the ${s.name ?? bare(s.key)} module`, `the rest of ${titleOf(s.design ?? "")}`] : s.between.map(titleOf);
    return {
      key: s.key, name: s.name ?? (s.kind === "module" ? `${titleOf(s.design ?? "")}: ${bare(s.key)}` : s.between.map(titleOf).join(" and ")), kind: s.kind, sides,
      ...(s.owner_role ? { ownerRole: plainName(s.owner_role) } : {}), ownerTeams: ownersOf(s.owner_role),
      checks: (s.checks ?? []).map((k) => ruleTitles.get(k)?.title ?? codeWords(k)), neverCross: (s.never_cross ?? []).map(bare),
      crossings: s.crossings.map((k) => cj.get(k)).filter((c): c is CrossingJudgement => !!c).map(crossingView).sort(order),
      undeclared: s.undeclared.map((k) => cj.get(k)).filter((c): c is CrossingJudgement => !!c).map(crossingView).sort(order),
      exceptions: s.exceptions.map(exceptionView),
    };
  });
  // a design's edges to a shared part that no seam names: grouped under the part, so nothing undeclared goes unseen
  const loose = data.seams.crossings.filter((c) => !c.seams.length);
  const byPart = new Map<string, CrossingJudgement[]>();
  for (const c of loose) for (const end of [c.from, c.to]) if (nsOf(end) === SHARED) { byPart.set(end, [...(byPart.get(end) ?? []), c]); break; }
  for (const [part, cs] of [...byPart].sort((a, b) => natCompare(a[0], b[0]))) {
    const p = el.get(part);
    const role = root.shared?.parts.find((x) => `${SHARED}:${x.id}` === part)?.owner;
    seams.push({
      key: part, name: `${p?.name ?? bare(part)}, a shared part`, kind: "shared", sides: [`${p?.name ?? bare(part)} (shared)`, "the designs that connect to it"],
      ...(role ? { ownerRole: role } : {}), ownerTeams: ownersOf(role), checks: [], neverCross: [],
      crossings: cs.filter((c) => c.declared).map(crossingView).sort(order), undeclared: cs.filter((c) => !c.declared).map(crossingView).sort(order), exceptions: [],
    });
  }
  const stalePins = data.findings.filter((f) => f.rule === "xref-pin-stale").map((f) => ({ design: f.design ?? "", text: readerText(f) }));

  // ── the findings ──
  // a finding's key on the page: its rule and record, and a count where one rule reports a record more than once
  const seenKeys = new Map<string, number>();
  const fkey = (f: Finding & { subject: string }) => { const k = `${f.pack}/${f.rule}@${f.subject}`; const n = (seenKeys.get(k) ?? 0) + 1; seenKeys.set(k, n); return n === 1 ? k : `${k}~${n}`; };
  const findings: PortfolioPageFacts["findings"] = data.findings.map((f) => {
    const r = ruleTitles.get(`${f.pack}/${f.rule}`);
    return {
      key: fkey(f), pack: f.pack, rule: f.rule, title: r?.title ?? `${f.pack} ${f.rule}`, ...(r?.why ? { why: r.why } : {}), severity: f.severity, subject: f.subject,
      subjectName: f.subject.includes(" (") ? `${titleOf(f.subject.split(" (")[0])}` : plainName(f.subject), text: readerText(f), ...(f.design ? { design: f.design } : {}),
      ...(f.composedOnly ? { composedOnly: true } : {}), ...(f.excepted_by ? { excepted: f.excepted_by.replace(/ on [a-z][a-z0-9-]*:[^\s]+$| on [a-z][a-z0-9-]*$/, "") } : {}),
    };
  });
  const composedOnly = findings.filter((f) => f.composedOnly).map((f) => ({ key: f.key, text: f.text }));
  const rules = [...new Set(findings.map((f) => `${f.pack}/${f.rule}`))].map((k) => { const r = ruleTitles.get(k); return { key: k, title: r?.title ?? k, why: r?.why ?? "", severity: r?.severity ?? "warning" }; });

  // ── the estimates ──
  const KIND_ORDER = (e: EstimateRow) => (e.field === "capacity" ? 0 : e.field === "share" ? 1 : e.field.startsWith("relieved_by") ? 2 : 3);
  const teamOrder = new Map((L?.teams ?? []).map((t, i) => [t.team, i]));
  const estimates: EstimateRow[] = (org?.estimates ?? []).map((e) => estimateRow(e, { org, today, impacts: opts.impacts ?? [], teamName, adapter: adapterWord(run) }))
    .sort((a, b) => (teamOrder.get(a.team ?? "") ?? 99) - (teamOrder.get(b.team ?? "") ?? 99) || natCompare(a.teamName ?? "", b.teamName ?? "") || KIND_ORDER(a) - KIND_ORDER(b) || natCompare(a.what, b.what));
  // the payoff: once a relief has landed, the projected share beside the measured one
  for (const e of estimates) {
    const p = e.field === "share" ? L?.activities.find((a) => a.activity === e.record)?.payoff : undefined;
    if (p) e.payoff = { text: p.text, landed: p.landed };
  }

  // ── the root's patches ──
  const said0 = (fs: PortfolioImpact["introduced"]) => list(fs.map((f) => `${quote(ruleTitles.get(`${f.pack}/${f.rule}`)?.title ?? `${f.pack} ${f.rule}`)} on ${plainName(f.subject)}`), { max: 4, more: "others" });
  const verdictReasons = (im: PortfolioImpact): string[] => {
    const errs = im.introduced.filter((f) => f.severity === "error"), warns = im.introduced.filter((f) => f.severity === "warning");
    return [errs.length ? sentence(`It adds ${count(errs.length, "error")}: ${said0(errs)}`) : "", warns.length ? sentence(`It adds ${count(warns.length, "warning")}: ${said0(warns)}`) : ""].filter(Boolean);
  };
  const impactEffect = (im: PortfolioImpact): string => {
    const verb = im.status === "accepted" ? "Keeping it" : "Accepting it";
    const fw = !im.introduced.length && !im.resolved.length ? `${verb} changes no finding of the portfolio.`
      : sentence(`${verb} ${[im.introduced.length ? `adds ${count(im.introduced.length, "finding")} (${said0(im.introduced)})` : "", im.resolved.length ? `resolves ${count(im.resolved.length, "finding")} (${said0(im.resolved)})` : ""].filter(Boolean).join(" and ")}`);
    return [fw, ...(im.teams ?? []).map((t) => t.text)].join(" ");
  };
  const patches: RootPatchView[] = (root.patches ?? []).map((p) => {
    const pv = p.provenance;
    const agent = !!(pv && (pv.author === "agent" || pv.agent));
    const im = (opts.impacts ?? []).find((x) => x.patch === p.id);
    return {
      id: p.id, title: p.title, status: p.status, ...(p.why ? { why: p.why } : {}),
      by: agent ? (pv?.agent?.name ?? "an agent") : (pv?.author && pv.author !== "person" ? pv.author : pv?.requested_by ?? "a person"), agent,
      ...(pv?.created ? { created: String(pv.created).slice(0, 10) } : {}),
      ...(p.decision ? { decision: { by: p.decision.by, at: String(p.decision.at).slice(0, 10), ...(p.decision.reason ? { reason: p.decision.reason } : {}) } } : {}),
      ...(im ? { verdict: { level: im.verdict.level, reasons: verdictReasons(im) }, effect: impactEffect(im) } : {}),
      ops: p.ops.map((op) => opWords(op as unknown as Raw, { plainName, org })),
    };
  }).sort((a, b) => (a.status === "proposed" ? 0 : a.status === "accepted" ? 1 : 2) - (b.status === "proposed" ? 0 : b.status === "accepted" ? 1 : 2) || natCompare(a.id, b.id));

  // ── the root's notes and questions, each on its record by name ──
  const ROOT_NS: Record<string, string> = { team: ORG, activity: ORG, slowdown: ORG, exception: ORG };
  const notes: PortfolioPageFacts["notes"] = (root.notes?.notes ?? []).map((n) => {
    const t = n.target;
    const ref = parseRef(t.id).ns ? t.id : `${ROOT_NS[t.kind] ?? SHARED}:${t.id}`;
    const seam = t.kind === "seam" ? page0Seam(ref) : undefined;
    return { id: n.id, kind: n.kind, status: n.status, text: n.text, ...(n.answer ? { answer: n.answer } : {}), author: n.author, created: String(n.created).slice(0, 10), target: ref, targetName: seam ?? plainName(ref) };
  });

  // ── the focus across designs ──
  const orgTeams = root.org?.teams ?? [];
  // what a finding's record stands for: a crossing or relationship by its two ends, an org record by its team
  const ends: Record<string, string[]> = {};
  for (const r of run.graph?.model.relationships ?? []) ends[r.id] = [r.from, r.to];
  for (const c of data.seams.crossings) ends[c.id] = [c.from, c.to];
  const teamOf: Record<string, string> = {};
  for (const a of org?.activities ?? []) teamOf[`${ORG}:${a.id}`] = a.team.startsWith(`${ORG}:`) ? a.team : `${ORG}:${a.team}`;
  for (const sd of org?.slowdowns ?? []) { const a = activityOf.get(sd.activity.startsWith(`${ORG}:`) ? sd.activity : `${ORG}:${sd.activity}`); if (a) teamOf[`${ORG}:${sd.id}`] = a.team.startsWith(`${ORG}:`) ? a.team : `${ORG}:${a.team}`; }
  const options = portfolioFocusOptions(designs.map((d) => ({ ns: d.ns, bundle: d.bundle })), orgTeams);
  const facts: Record<string, PortfolioFocusFacts> = {};
  for (const o of [...options.teams, ...options.leads])
    facts[`${o.kind}:${o.id}`] = portfolioFocusFacts(o, designs.map((d) => ({ ns: d.ns, bundle: d.bundle })), { orgTeams, sharedParts, ends, teamOf, findings: findings.map((f) => ({ key: f.key, subject: f.subject, ...(f.design ? { design: f.design } : {}) })) });

  // ── the sentence ──
  const relevantUndeclared = data.seams.undeclared.filter((c) => (c.mark ? c.mark.relevant : true));
  const undeclared = { relevant: relevantUndeclared.length, excepted: relevantUndeclared.filter((c) => c.exception && c.exception.state === "in force").length };
  const terms = [...ENGINE_GLOSSARY, ...GLOSSARY_04].map(([term, definition, forms]) => ({ term, definition, forms: forms ?? defaultForms(term), source: "engine" as const }));

  return {
    today, mode: modeW, sentence: openingSentence(data, undeclared), designs: links,
    roadmap: { months, rows, noDate }, seams, stalePins, composedOnly, estimates, patches, findings, rules, notes,
    focus: { key: `de-focus:portfolio:${data.portfolio.name}`, options, facts },
    glossary: terms,
  };
}

/** Every rule a finding of the portfolio can name, with its title and why: the designs' packs, and the root's and the portfolio's. */
async function ruleTitleMap(run: PortfolioRun): Promise<Map<string, { title: string; why: string; severity: string }>> {
  const m = new Map<string, { title: string; why: string; severity: string }>();
  for (const d of run.designs) for (const p of d.bundle?.instance.packs ?? []) for (const r of p.rules) m.set(`${p.name}/${r.id}`, { title: r.title, why: r.why, severity: r.severity });
  for (const p of run.rootCheck?.packs ?? []) for (const r of p.rules) if (!m.has(`${p.name}/${r.id}`)) m.set(`${p.name}/${r.id}`, { title: r.title, why: r.why, severity: r.severity });
  const { packs } = await loadPacks(["portfolio", "org", "shared", "generic", "security"]);
  for (const p of packs) for (const r of p.rules) if (!m.has(`${p.name}/${r.id}`)) m.set(`${p.name}/${r.id}`, { title: r.title, why: r.why, severity: r.severity });
  return m;
}

const adapterWord = (run: PortfolioRun) => (run.rootCheck?.tracker?.mapping?.adapter ?? run.rootCheck?.tracker?.inventory?.adapter) === "jira" ? "Jira" : "the tracker";

/** One org number as the Estimates table and the load bars say it. */
export function estimateRow(e: EstimateFacts, ctx: { org?: OrgView; today: string; impacts: PortfolioImpact[]; teamName: (id: string) => string; adapter?: string }): EstimateRow {
  const a = ctx.org?.activities.find((x) => `${ORG}:${x.id}` === e.record);
  const sd = ctx.org?.slowdowns.find((x) => `${ORG}:${x.id}` === e.record);
  const sdAct = sd ? ctx.org?.activities.find((x) => x.id === sd.activity || `${ORG}:${x.id}` === sd.activity) : undefined;
  const unit: EstimateRow["unit"] = e.field === "capacity" ? "slots" : "share";
  const vt = (v: number) => (unit === "slots" ? slots(v) : pct(v));
  const what = e.kind === "team" ? "Capacity"
    : sd ? `During the slowdown: ${sdAct?.name ?? sd.activity}`
    : e.field.startsWith("relieved_by") ? `After relief: ${a?.name ?? e.record}`
    : `Share: ${a?.name ?? e.record}`;
  const v = e.value;
  const latest = e.measured?.latest;
  const by = (s: string) => s.replace(/^(agent|tracker|derived):/, "");
  let provenance = "Not stated";
  if (v) {
    const when = shortDay(v.as_of, ctx.today);
    if (v.source === "person") provenance = `${vt(v.value)} · stated by ${v.by}, ${when}, ${v.confidence}`;
    else if (v.source === "tracker") {
      const m = latest && latest.as_of === v.as_of ? latest : e.measured?.series.find((p) => p.as_of === v.as_of);
      provenance = `${vt(v.value)}${unit === "share" ? " of in-progress time" : ""} · measured from ${ctx.adapter ?? "the tracker"}${m ? `, ${m.window_days} days to ${when}, ${count(m.issues, "issue")}` : `, ${when}`}, ${v.confidence}`;
    } else if (v.source === "agent") provenance = `${vt(v.value)} · estimated by ${by(v.by)}, ${when}, ${v.confidence}`;
    else provenance = `${vt(v.value)} · derived (${by(v.by)}), ${when}, ${v.confidence}`;
    if (e.stale && e.ageDays !== undefined) provenance += ` · ${count(e.ageDays, "day")} old, past the age when an estimate counts as current`;
  } else if (e.problems.length) provenance = `Not valid: ${e.problems.join("; ")}`;
  const trend: EstimateRow["trend"] = [];
  for (const h of e.history) if (h.as_of) trend.push({ as_of: h.as_of, value: h.value, source: h.source === "person" ? `stated by ${h.by}` : h.source === "tracker" ? `measured${h.patch ? `, accepted in ${h.patch}` : ""}` : h.source ? `${h.source}${h.by ? ` (${by(h.by)})` : ""}` : "as written", kind: "value" });
  for (const p of e.measured?.series ?? []) trend.push({ as_of: p.as_of, value: p.value, source: `from ${ctx.adapter ?? "the tracker"}, ${count(p.issues, "issue")}, ${p.confidence}`, kind: "measured" });
  const stated = v?.stated ?? (v?.source === "person" ? undefined : undefined);
  if (stated) trend.push({ as_of: stated.as_of, value: stated.value, source: `stated by ${stated.by}`, kind: "stated" });
  trend.sort((x, y) => x.as_of.localeCompare(y.as_of));
  const pending = e.pending.map((p) => {
    const im = ctx.impacts.find((x) => x.patch === p.patch);
    const val = typeof p.value === "number" ? vt(p.value) : p.value && typeof p.value === "object" && typeof (p.value as Raw).value === "number" ? vt((p.value as Raw).value as number) : "a new value";
    const who = p.agent ?? p.author ?? "someone";
    const over = (im?.teams ?? []).filter((t) => t.after.over && !t.before.over).map((t) => t.name);
    const back = (im?.teams ?? []).filter((t) => !t.after.over && t.before.over).map((t) => t.name);
    const verdict = im ? ` · ${im.verdict.level}: ${over.length ? `${list(over)} ${over.length === 1 ? "goes" : "go"} over capacity` : back.length ? `${list(back)} ${back.length === 1 ? "comes" : "come"} back within capacity` : im.verdict.level === "pass" ? "no team goes over capacity" : "it adds a finding"}` : "";
    return { patch: p.patch, text: `Proposed ${val} by ${who}${p.created ? ` on ${shortDay(String(p.created).slice(0, 10), ctx.today)}` : ""}${verdict}` };
  });
  return {
    record: e.record, field: e.field, ...(e.team ? { team: e.team, teamName: ctx.teamName(e.team) } : {}), what, unit,
    ...(v ? { value: v.value } : {}), valueText: v ? vt(v.value) : "not stated", provenance,
    ...(e.ageDays !== undefined ? { age: e.ageDays } : {}), stale: e.stale, trend,
    ...(latest ? { measured: { value: latest.value, text: unit === "slots" ? `${fmt(Math.round(latest.value * 10) / 10)} in progress on average, measured ${shortDay(latest.as_of, ctx.today)}` : `${vt(latest.value)} measured, ${shortDay(latest.as_of, ctx.today)}` } } : {}),
    ...(e.measured?.gap ? { gap: { over: e.measured.gap.over, text: e.measured.gap.text } } : {}),
    pending, ...(e.rowOwner ? { rowOwner: e.rowOwner } : {}), problems: e.problems,
  };
}

/** One op of a root patch, in words. */
function opWords(op: Raw, ctx: { plainName: (id: string) => string; org?: OrgView }): string {
  const kind = String(op.kind ?? "record");
  const ns = ["team", "activity", "slowdown", "exception"].includes(kind) ? ORG : SHARED;
  const id = String(op.id ?? (op.value && typeof op.value === "object" ? (op.value as Raw).id ?? (op.value as Raw).name ?? "" : ""));
  const name = id ? ctx.plainName(`${ns}:${id}`) : kind;
  const KIND: Record<string, string> = { team: "team", activity: "activity", slowdown: "slowdown", exception: "exception", element: "shared part", relationship: "crossing", contract: "contract", capability: "capability", seam: "seam", system: "system", zone: "zone", claim: "claim", "manual-work": "kind of manual work" };
  const k = KIND[kind] ?? kind;
  if (op.op === "add") return sentence(`Adds the ${k} ${name === kind ? "" : name}`.replace(/\s+$/, ""));
  if (op.op === "remove") return sentence(`Removes the ${k} ${name}`);
  const set = (op.set && typeof op.set === "object" ? op.set : {}) as Raw;
  const parts = Object.entries(set).map(([f, v]) => {
    if (f === "security" && v && typeof v === "object") return (v as Raw).raised ? `raises its mark (${String(((v as Raw).raised as Raw).by ?? "")})` : "changes its mark";
    if (v && typeof v === "object" && typeof (v as Raw).value === "number") {
      const x = (v as Raw).value as number;
      return `sets its ${f === "share" ? "share" : f === "capacity" ? "capacity" : f.replace(/_/g, " ")} to ${f === "capacity" ? slots(x) : f.startsWith("share") ? pct(x) : fmt(x)}${(v as Raw).source === "tracker" ? ", measured" : (v as Raw).source === "person" ? `, stated by ${(v as Raw).by}` : ""}`;
    }
    return `sets its ${f.replace(/_/g, " ")}`;
  });
  return sentence(`${k.charAt(0).toUpperCase() + k.slice(1)} ${name}: ${parts.join("; ") || "changed"}`);
}

/** The context a design page built inside the portfolio carries (bundle.portfolio). */
export function designContext(data: PortfolioData, page: PortfolioPageFacts, ns: string): PortfolioContext {
  const d = page.designs.find((x) => x.namespace === ns)!;
  return {
    name: data.portfolio.name, title: data.portfolio.title, mode: data.portfolio.mode, href: "../index.html", namespace: ns, label: d.label,
    modeLine: designModeLine(data.portfolio.mode, d.label, page.today),
    designs: page.designs.map((x) => ({ ...x, href: x.namespace === ns ? "index.html" : `../${encodeURIComponent(x.namespace)}/index.html` })),
    focusKey: page.focus.key, focus: page.focus.options,
  };
}

export { claimShort };
