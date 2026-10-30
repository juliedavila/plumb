// Present mode: <instance>/deck.yaml, one leadership template whose slides are queries over the bundle.
//
// Slides speak in outcomes, names and consequences: milestones by name, work by title, teams by name, status as red,
// amber or green with its reason in words. Ids, record counts and rule names go in the speaker notes, for the
// presenter. Every sentence goes through the prose helpers (src/site/client/prose.js). The decisions slide is written
// by hand in deck.yaml and never generated; the engine lists candidate decisions in its speaker notes only. One "as
// of" line sits on the status slide. A slide whose query names something the bundle does not hold still renders, and
// the build warns.
//
//   title: Where it stands                # the deck's title (default: the instance title)
//   subtitle: For the steering group      # optional
//   slides:
//     - template: title
//     - template: status                  # "Where we stand": the milestone road; milestones: [ids] (default: every one; gates: still read)
//     - template: milestones              # "What each milestone means": what each delivers and what reaching it lets us do
//     - template: challenges              # "What is in the way": three to five, red first; limit: 5
//     - template: path                    # "Path to green": per milestone not green, its steps with owners; limit: 4 steps; two milestones a slide
//     - template: risks                   # each load-bearing untested premise as a bet; limit: 3
//     - template: changes                 # since the last presented report, else the last saved one
//     - template: decisions               # items: [{ decision, why?, refs?: [ids] }]: hand-written
//     - template: thesis                  # still read: claim: <id>; premises: rests-on | all | [ids]; limit: 5
//   Each slide may carry `title:` (its heading) and `notes:` (the author's speaker notes, after the computed ones).

import { existsSync, readFileSync } from "node:fs";
import { milestoneFlowLine } from "./flow.ts";
import { join } from "node:path";
import type { Bundle, Claim, Deck, DeckItem, DeckMilestone, DeckSlide, DeckTemplate, MilestoneStatus, PathAction, Phase } from "../types.ts";
import { dayText, shortOf } from "./status.ts";
import { PROSE } from "../site/prose.ts";
import { DIGEST } from "./digest.ts";
import { weight } from "./premise.ts";
import { natCompare } from "./util.ts";
import { patchesNamed, statusConflicts, verdictConflict, VERDICT_TEXT } from "./text-checks.ts";

const { count, fmt, list, sentence, para, quote, verb } = PROSE;
export const DECK_TEMPLATES: DeckTemplate[] = ["title", "status", "milestones", "challenges", "path", "risks", "changes", "decisions", "thesis"];
const DEFAULT_TITLES: Record<DeckTemplate, string> = {
  title: "", thesis: "What the plan is betting on", status: "Where we stand", changes: "What changed since the last report",
  risks: "Risks", decisions: "Decisions needed", milestones: "What each milestone means", challenges: "What is in the way", path: "Path to green",
};

type Raw = Record<string, unknown>;
export interface DeckConfig { title?: string; subtitle?: string; slides: Raw[] }

/** Read <dir>/deck.yaml. Absent: no deck. Problems are returned, never thrown. */
export function loadDeckConfig(dir: string): { config?: DeckConfig; problems: string[] } {
  const path = join(dir, "deck.yaml");
  if (!existsSync(path)) return { problems: [] };
  let raw: unknown;
  try { raw = Bun.YAML.parse(readFileSync(path, "utf8")); } catch (e) { return { problems: [`deck.yaml: YAML parse error: ${(e as Error).message}`] }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problems: ["deck.yaml: must be a mapping with title and slides"] };
  const r = raw as Raw;
  const problems: string[] = [];
  if (!Array.isArray(r.slides)) problems.push("deck.yaml: slides must be a list");
  const slides = (Array.isArray(r.slides) ? r.slides : []).filter((s, i) => {
    if (s && typeof s === "object" && !Array.isArray(s)) return true;
    problems.push(`deck.yaml slide ${i + 1}: not a mapping; skipped`);
    return false;
  }) as Raw[];
  return { config: { ...(r.title != null ? { title: String(r.title) } : {}), ...(r.subtitle != null ? { subtitle: String(r.subtitle) } : {}), slides }, problems };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "22 Oct 2026" (or with the time) in the local time zone of the build. */
export function humanDate(iso: string | undefined, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : day;
}

const pct = (n: number, of: number) => (!of ? "0%" : n > 0 && Math.round((n / of) * 100) === 0 ? "under 1%" : `${Math.round((n / of) * 100)}%`);
/** "29 of 148 parts (20%)": the count and its denominator first, the percentage after. */
export function share(n: number, of: number, one: string, many?: string): string {
  return `${fmt(n)} of ${count(of, one, many)} (${pct(n, of)})`;
}
const GRADE_WORD: Record<string, string> = { evidence: "Evidence", inference: "Inference", judgment: "Judgment", untested: "Untested" };
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : v == null ? undefined : [String(v)]);
/** A clause dropped in after a colon: its first letter lowered, unless it starts an acronym or an id. */
const lc = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const notesOf = (s: Raw): string[] => (s.notes == null ? [] : Array.isArray(s.notes) ? s.notes.map(String) : [String(s.notes)]).map((x) => x.trim()).filter(Boolean);

interface Ctx { b: Bundle; warn: (m: string) => void; n: number }

function phaseOrder(b: Bundle) { return [...b.plan.phases].sort((a, c) => (a.order ?? 0) - (c.order ?? 0) || natCompare(a.id, c.id)); }
function uniqueUnits(b: Bundle) { const seen = new Set<string>(); return b.plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true))); }
const loadBearingIds = (b: Bundle) => b.findings.filter((f) => f.pack === "premises" && f.rule === "load-bearing-untested").map((f) => f.at);
const claimWeight = (b: Bundle, id: string) => (b.premises?.[id] ? weight(b.premises[id]) : 0);
const trackerName = (b: Bundle) => (b.tracker?.adapter === "jira" ? "Jira" : b.tracker?.adapter ?? "the tracker");

/** Does an id name something in the bundle? (claims, units, parts, milestones, patches, notes, or a rule as pack/rule) */
export function knownRef(b: Bundle, id: string): boolean {
  if ((b.model.claims ?? []).some((c) => c.id === id)) return true;
  if (b.plan.units.some((u) => u.id === id) || b.plan.phases.some((p) => p.id === id)) return true;
  if (b.model.elements.some((e) => e.id === id) || b.patches.some((p) => p.id === id)) return true;
  if ((b.notes?.items ?? []).some((n) => n.id === id) || b.model.teams.some((t) => t.id === id)) return true;
  return b.instance.packs.some((p) => p.rules.some((r) => `${p.name}/${r.id}` === id));
}

// ---------- slides ----------
// What a slide shows is for the room: outcomes, names and consequences, never ids, record counts or rule names. Those
// go in the speaker notes, for the presenter.

function titleSlide(c: Ctx, s: Raw, deck: DeckConfig): DeckSlide {
  const b = c.b;
  return {
    template: "title", title: String(s.title ?? deck.title ?? b.instance.title),
    ...(s.subtitle ?? deck.subtitle ?? b.instance.description ? { subtitle: String(s.subtitle ?? deck.subtitle ?? b.instance.description) } : {}),
    notes: [sentence(`Every number in this deck comes from the build of ${humanDate(b.engine.built, true)}; the decisions slide is the only one written by hand`), ...notesOf(s)],
  };
}

/** The claim the deck leads with: the one named, else the claim nothing else rests on that carries the most. */
function thesisClaim(c: Ctx, s: Raw): Claim | undefined {
  const cs = c.b.model.claims ?? [];
  if (s.claim != null) {
    const found = cs.find((x) => x.id === String(s.claim));
    if (!found) c.warn(`deck.yaml slide ${c.n} (thesis): claim ${String(s.claim)} is not in the model`);
    return found;
  }
  const restedOn = new Set(cs.flatMap((x) => x.rests_on ?? []));
  return cs.filter((x) => x.kind === "claim" && !restedOn.has(x.id)).sort((x, y) => claimWeight(c.b, y.id) - claimWeight(c.b, x.id) || natCompare(x.id, y.id))[0];
}

/** Every claim a claim rests on, however deep. */
function chain(cs: Claim[], id: string): Set<string> {
  const by = new Map(cs.map((x) => [x.id, x])), out = new Set<string>(), stack = [...(by.get(id)?.rests_on ?? [])];
  while (stack.length) { const n = stack.pop()!; if (out.has(n) || !by.has(n)) continue; out.add(n); stack.push(...(by.get(n)!.rests_on ?? [])); }
  return out;
}

function thesisSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b, cs = b.model.claims ?? [];
  const title = String(s.title ?? DEFAULT_TITLES.thesis);
  if (!cs.length) { c.warn(`deck.yaml slide ${c.n} (thesis): the model declares no claims`); return { template: "thesis", title, lead: "This design declares no claims yet.", notes: notesOf(s) }; }
  const claim = thesisClaim(c, s);
  const lb = new Set(loadBearingIds(b));
  const limit = Number(s.limit) > 0 ? Math.floor(Number(s.limit)) : 5;
  let pool: Claim[];
  const q = s.premises;
  if (Array.isArray(q)) {
    pool = q.map(String).map((id) => { const x = cs.find((y) => y.id === id); if (!x) c.warn(`deck.yaml slide ${c.n} (thesis): premise ${id} is not in the model`); return x; }).filter((x): x is Claim => !!x);
  } else if (q === "all" || !claim) pool = cs.filter((x) => x.kind !== "claim");
  else { const ch = chain(cs, claim.id); pool = cs.filter((x) => ch.has(x.id) && x.kind !== "claim"); }
  const ranked = [...pool].sort((x, y) => Number(lb.has(y.id)) - Number(lb.has(x.id)) || claimWeight(b, y.id) - claimWeight(b, x.id) || natCompare(x.id, y.id));
  const shown = Array.isArray(q) ? ranked : ranked.slice(0, limit);
  const untested = pool.filter((x) => x.grade === "untested").length, heavy = pool.filter((x) => lb.has(x.id)).length;
  const lead = !pool.length ? "It rests on no premise the model declares."
    : para([
      untested ? (heavy ? "Some of what it rests on is untested and carries much of the design; those come first" : "Some of what it rests on is still untested") : "Every premise under it is backed by evidence, inference or a person's judgment",
      shown.length < pool.length ? "These are the ones that carry the most" : "",
    ]);
  const items: DeckItem[] = shown.map((x) => ({
    id: x.id, text: x.statement, grade: x.grade, tone: lb.has(x.id) ? "warning" : undefined,
    sub: `${GRADE_WORD[x.grade] ?? x.grade}${lb.has(x.id) ? " · much of the design rests on it" : ""}`,
  }));
  const notes = [
    claim ? sentence(`The claim is ${claim.id}, graded ${(GRADE_WORD[claim.grade] ?? claim.grade).toLowerCase()}${claim.source ? `; its source: ${lc(claim.source.replace(/[.\s]+$/, ""))}` : ""}`) : "",
    pool.length ? sentence(`It rests on ${count(pool.length, "premise")}${claim && q !== "all" ? (Array.isArray(q) ? " named here" : ", directly or through other claims") : ""}; ${fmt(untested)} untested, ${fmt(heavy)} of them load-bearing`) : "",
    ...shown.map((x) => sentence(`${x.id}: ${count(claimWeight(b, x.id), "record")} ${verb(claimWeight(b, x.id), "rests", "rest")} on it${lb.has(x.id) ? " (load-bearing and untested)" : ""}`)),
    ...shown.filter((x) => lb.has(x.id) && x.fallback).map((x) => sentence(`If ${x.id} is false, the fallback: ${lc(x.fallback!.replace(/[.\s]+$/, ""))}`)),
    ...notesOf(s),
  ].filter(Boolean);
  return { template: "thesis", title, ...(claim ? { subtitle: claim.statement } : {}), lead, items, notes };
}

const phaseName = (b: Bundle, id: string) => b.plan.phases.find((p) => p.id === id)?.name ?? id;
const unitTitle = (b: Bundle, id: string) => b.plan.units.find((u) => u.id === id)?.title ?? id;
const teamName = (b: Bundle, id: string) => b.model.teams.find((t) => t.id === id)?.name ?? id;

/** A milestone's reason in one line, for the road: what is in the way, naming the work, never counting it. */
export function shortReason(b: Bundle, m: MilestoneStatus): string {
  if (m.reached) return "Reached.";
  // a person's call is shown whole, with its commitment: "On course." alone hides what it rests on
  if (m.override) return sentence(m.override.reason.replace(/[.\s]+$/, "") || `Set to ${m.override.status} by hand`);
  const r = m.reasons[0];
  if (!r) return "Nothing in the plan stands in its way.";
  return r.short ?? shortOf(b, r); // the one line the Overview and the milestone card say too (src/core/status.ts)
}

function deckMilestones(c: Ctx, phases: Phase[]): DeckMilestone[] {
  const b = c.b;
  return phases.map((p) => {
    const m = b.status?.milestones.find((x) => x.phase === p.id);
    const status = m?.status ?? "green";
    const marker = m && !m.reached && status !== "green" ? (status === "red" ? "blocked" : "attention") : undefined;
    return {
      phase: p.id, name: p.name || p.id, ...(p.delivers ? { delivers: p.delivers } : {}), ...(p.means ? { means: p.means } : {}),
      status, reason: m ? shortReason(b, m) : "", ...(marker ? { marker } : {}),
      ...(m?.override ? { override: `Status set manually by ${m.override.by || "a person"}${m.override.date ? `, ${dayText(m.override.date)}` : ""}${m.override.review_by ? `; review by ${dayText(m.override.review_by)}` : ""}` } : {}),
      ...(m?.override && m.computed !== m.status ? { computed: m.computed } : {}),
      ...(m?.flags?.length ? { flags: m.flags.map((x) => x.text) } : {}),
      ...(m?.accountable ? { accountable: m.accountable } : {}),
      ...(p.lead ? { leadName: p.lead } : {}), // who owns delivering it: a name or a role title, allowed on a slide like a team
      reached: !!m?.reached, current: !!m?.current,
      ...(!m?.reached && milestoneFlowLine(b, p.id) ? { flow: milestoneFlowLine(b, p.id) } : {}),
    } as DeckMilestone;
  });
}

/** The presenter's mechanics for each milestone: progress counts, the computed status and its rules, ids. */
function milestoneNotes(c: Ctx, phases: Phase[]): string[] {
  const b = c.b, units = uniqueUnits(b), frontier = new Set(b.analysis?.frontier ?? []);
  return phases.map((p) => {
    const us = units.filter((u) => u.phase === p.id), m = b.status?.milestones.find((x) => x.phase === p.id);
    const done = us.filter((u) => u.status === "done").length, doing = us.filter((u) => u.status === "doing").length, ready = us.filter((u) => u.status !== "done" && u.status !== "doing" && frontier.has(u.id)).length;
    const crit = m ? [...new Set(m.reasons.map((r) => r.criterion))] : [];
    return sentence(`${quote(p.name)} (${p.id}), ${p.lead ? `led by ${p.lead}` : "no lead named"}: ${fmt(done)} of ${count(us.length, "unit")} done, ${fmt(doing)} in progress, ${fmt(ready)} ready${m ? `; computed ${m.computed}${crit.length ? ` from ${crit.join(", ")}` : ""}` : ""}${m?.override && m.override.status !== m.computed ? `; shown ${m.override.status} by ${m.override.by}'s override, which disagrees with the computed ${m.computed}` : ""}`);
  });
}

/** The road's lead: the plan's status in a word, then the first milestone that is not green and why, in one line. */
function standLead(b: Bundle): string {
  const st = b.status;
  if (!st) return b.plan.phases.length ? "No status has been computed." : "The plan has no milestones.";
  if (st.overall.lead) return st.overall.lead.text; // the sentence the Overview opens with: one status, one reason, everywhere
  const first = st.milestones.find((m) => !m.reached && m.status === st.overall.status) ?? st.milestones.find((m) => !m.reached && m.status !== "green");
  const word = { red: "red", amber: "amber", green: "green" }[st.overall.status];
  if (!first) return st.milestones.every((m) => m.reached) ? "Every milestone is reached." : sentence(`Overall green: every milestone still ahead is on course`);
  return `Overall ${word}. ${sentence(`${quote(phaseName(b, first.phase))} ${first.status === "red" ? "is blocked" : "needs attention"}: ${lc(shortReason(b, first).replace(/[.\s]+$/, ""))}`)}`;
}

function statusSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b;
  let phases = phaseOrder(b);
  const want = strList(s.milestones ?? s.gates);
  if (want) {
    for (const g of want) if (!phases.some((p) => p.id === g)) c.warn(`deck.yaml slide ${c.n} (status): milestone ${g} is not in the plan`);
    phases = phases.filter((p) => want.includes(p.id));
  }
  const rec = b.tracker?.reconcile;
  const notes = [
    ...milestoneNotes(c, phases),
    sentence(`Status criteria from engine.yaml: red when ${list(b.status?.criteria.red ?? [])}; amber when ${list(b.status?.criteria.amber ?? [])}`),
    sentence(`Critical path: ${count(b.analysis?.critical_path?.length ?? 0, "unit")} remain on the longest chain`),
    ...(rec ? [sentence(`${trackerName(b)}: ${fmt(rec.counts.linked)} matched; disagreements: ${fmt(rec.counts.statusDisagreements)} on status, ${fmt(rec.counts.phaseDisagreements)} on the milestone, ${fmt(rec.counts.dependencyOneSided)} on dependencies, ${fmt(rec.ownerDisagreements?.length ?? 0)} on the owner team`)] : []),
    ...notesOf(s),
  ];
  return {
    template: "status", title: String(s.title ?? DEFAULT_TITLES.status),
    lead: standLead(b),
    milestones: deckMilestones(c, phases),
    asOf: { built: b.engine.built, ...(b.tracker?.latestUpdate ? { tracker: b.tracker.latestUpdate } : {}) },
    notes,
  };
}

function milestonesSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b, phases = phaseOrder(b);
  const missing = phases.filter((p) => !p.delivers || !p.means);
  if (missing.length) c.warn(`deck.yaml slide ${c.n} (milestones): ${list(missing.map((p) => p.id))} ${missing.length === 1 ? "says" : "say"} nothing of what ${missing.length === 1 ? "it delivers or means" : "they deliver or mean"} (delivers, means)`);
  return {
    template: "milestones", title: String(s.title ?? DEFAULT_TITLES.milestones),
    lead: "Each milestone is a checkpoint where a complete piece of value is delivered, and reaching it lets us do or claim something we cannot today.",
    milestones: deckMilestones(c, phases),
    notes: [...phases.map((p) => sentence(`${quote(p.name)} (${p.id}) is reached when its exit test passes: ${lc(p.exit_test.replace(/[.\s]+$/, ""))}`)), ...notesOf(s)],
  };
}

function challengesSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b, cs = b.status?.challenges ?? [];
  const limit = Number(s.limit) > 0 ? Math.min(5, Math.floor(Number(s.limit))) : 5;
  const shown = cs.slice(0, limit);
  return {
    template: "challenges", title: String(s.title ?? DEFAULT_TITLES.challenges),
    lead: !shown.length ? "Nothing in the plan stands in the way of any milestone." : shown.some((x) => x.level === "red") ? "What is most in the way, the work that blocks a milestone first." : "Nothing blocks a milestone; these need attention.",
    items: shown.map((x) => ({ text: x.text, rag: x.level, tone: x.level === "red" ? "fail" : "warning" } as DeckItem)),
    notes: [...shown.map((x, i) => sentence(`${i + 1}: ${x.criterion}, on ${list(x.refs.map((r) => r.id), { max: 6 })}, holding up ${list(x.milestones)}`)), ...notesOf(s)],
  };
}

/** Path to green: one group per milestone that is not green, two to a slide; each action with its owner and what it unblocks. */
function pathSlides(c: Ctx, s: Raw): DeckSlide[] {
  const b = c.b, title = String(s.title ?? DEFAULT_TITLES.path);
  const per = Number(s.limit) > 0 ? Math.floor(Number(s.limit)) : 4;
  const ms = (b.status?.milestones ?? []).filter((m) => !m.reached && m.status !== "green");
  const hidden = (b.status?.milestones ?? []).filter((m) => !m.reached && m.status === "green" && m.computed !== "green");
  const hiddenNotes = hidden.map((m) => sentence(`${quote(phaseName(b, m.phase))} shows green by ${m.override?.by ?? "hand"}'s override; computed ${m.computed}, its path would start: ${lc((m.path[0]?.text ?? "").replace(/[.\s]+$/, ""))}`));
  if (!ms.length) return [{ template: "path", title, lead: "Every milestone not yet reached is green: there is no path to clear.", notes: [...hiddenNotes, ...notesOf(s)] }];
  const action = (a: PathAction): DeckItem => {
    // read aloud: one team, then "and other teams"; the first piece of work it frees, then "and the work after it"
    const un = a.unblocks.length ? `unblocks ${quote(unitTitle(b, a.unblocks[0]))}${a.unblocks.length > 1 ? " and the work after it" : ""}` : "";
    const acc = b.status?.milestones.find((m) => m.path.includes(a))?.accountable;
    const who = a.teams.length ? `${teamName(b, a.teams[0])}${a.teams.length > 1 ? " and other teams" : ""}` : acc ? `Needs an owner: ${acc} names one` : "Needs an owner";
    return { text: a.text, rag: a.level, tone: a.level === "red" ? "fail" : "warning", sub: [who, un].filter(Boolean).join(" · ") };
  };
  // A path cut short says so, and where the rest is: a slide that silently drops steps reads as the whole path.
  const more = (m: MilestoneStatus): DeckItem[] => m.path.length > per ? [{ text: sentence(`This is not the whole path: ${count(m.path.length - per, "more step")} ${verb(m.path.length - per, "is", "are")} on the Plan`), tone: "info", more: true }] : [];
  const groups = ms.map((m) => ({ title: phaseName(b, m.phase), rag: m.status, lead: [shortReason(b, m), milestoneFlowLine(b, m.phase) ?? ""].filter(Boolean).join(" "), items: [...m.path.slice(0, per).map(action), ...more(m)], m }));
  const out: DeckSlide[] = [];
  for (let i = 0; i < groups.length; i += 2) {
    const g = groups.slice(i, i + 2);
    out.push({
      template: "path", title: i ? `${title}, continued` : title,
      ...(i ? {} : { lead: "For each milestone that is not green, the steps that would turn it green, in order, with who owns each." }),
      groups: g.map(({ m: _m, ...x }) => x),
      notes: [
        ...g.flatMap((x) => [
          ...x.m.path.slice(0, per).map((a, j) => sentence(`${x.title} step ${j + 1}: ${a.criterion}${a.work ? ` on ${a.work.id}` : ""}${a.unblocks.length ? `, unblocks ${list(a.unblocks, { max: 6 })}` : ""}`)),
          ...(x.m.path.length > per ? [sentence(`${quote(x.title)} has ${count(x.m.path.length - per, "more step")}: ${x.m.path.slice(per).map((a) => a.text.replace(/[.\s]+$/, "")).join("; ")}`)] : []),
        ]),
        ...(i ? [] : hiddenNotes), ...notesOf(s),
      ],
    });
  }
  return out;
}

/** What each rule pack watches, as a reader in the room would name it. */
const AREA: Record<string, string> = {
  generic: "how the system fits together", flow: "handoffs between teams", notes: "open questions", plan: "the order of the work",
  premises: "what the plan rests on", security: "security", teams: "who owns the work", tracker: "the tracker keeping step with the plan",
};

function changesSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b, title = String(s.title ?? DEFAULT_TITLES.changes);
  const since = b.sinceReport;
  if (!since) return { template: "changes", title, lead: "No report has been saved yet, so there is nothing to compare with. Run bun plumb.ts report to start the record.", notes: notesOf(s) };
  const a = since.against, d = since.diff;
  const basis = since.basis === "presented"
    ? `Compared with the report presented on ${humanDate(a.presented, true)}`
    : `No report has been marked as presented; compared with the last one saved, on ${humanDate(a.saved, true)}`;
  const items: DeckItem[] = [], notes: string[] = [];
  const order = phaseOrder(b), units = uniqueUnits(b);
  // Status moves lead: "“See the stream” went amber to red". Worse is red-toned, better green.
  const RANKS: Record<string, number> = { green: 0, amber: 1, red: 2 };
  if (d.status) {
    for (const m of d.status.moves) items.push({ text: DIGEST.moveText(m), tone: RANKS[m.to] > RANKS[m.from] ? "fail" : "pass", rag: m.to as DeckItem["rag"] });
    if (d.status.overall) notes.push(sentence(`The plan overall went ${d.status.overall.from} to ${d.status.overall.to}`));
    if (!d.status.moves.length && !d.status.overall) notes.push("No milestone changed status.");
  }
  const titled = (xs: { name: string }[], max = 2) => { const t = xs.slice(0, max).map((x) => quote(x.name)); return xs.length > max ? `${t.join(", ")} and other work` : list(t); };
  for (const p of order) {
    const before = a.phases.find((x) => x.id === p.id);
    const us = units.filter((u) => u.phase === p.id), done = us.filter((u) => u.status === "done").length;
    if (!before) { items.push({ text: `${quote(p.name)} is a new milestone`, tone: "info" }); notes.push(sentence(`${p.id} is new: ${fmt(done)} of ${count(us.length, "unit")} done`)); continue; }
    if (before.done !== done || before.total !== us.length) {
      notes.push(sentence(`${p.id} ${quote(p.name)}: ${fmt(before.done)} of ${fmt(before.total)} done then, ${fmt(done)} of ${fmt(us.length)} now`));
      if (done === us.length && us.length) items.push({ text: `${quote(p.name)} is reached`, tone: "pass" });
      else if (done > before.done) items.push({ text: `${quote(p.name)} moved forward`, tone: "pass" });
      else if (us.length !== before.total) items.push({ text: `${quote(p.name)} has changed in scope`, tone: "info" });
    }
  }
  if (d.units.done.length) { items.push({ text: `Finished: ${titled(d.units.done)}`, tone: "pass" }); notes.push(sentence(`Newly done: ${list(d.units.done.map((x) => x.id), { max: 8 })}`)); }
  if (d.units.ready.length) { items.push({ text: `Now ready to start: ${titled(d.units.ready)}`, tone: "info" }); notes.push(sentence(`Newly ready: ${list(d.units.ready.map((x) => x.id), { max: 8 })}`)); }
  // Findings in leadership language: what area of the work changed and why it matters. Rule titles are the
  // presenter's, in the notes. Separation of duties stays off the deck (a team-level proxy, for the Teams page only).
  const kept = (xs: { id: string; name: string }[]) => xs.filter((x) => !/team-level proxy/.test(x.name));
  const ruleOf = (x: { id: string }) => x.id.slice(0, x.id.lastIndexOf("@") < 0 ? x.id.length : x.id.lastIndexOf("@"));
  const areas = (xs: { id: string }[]) => [...new Set(xs.map((x) => AREA[ruleOf(x).split("/")[0]] ?? "the design"))];
  const byRule = (xs: { id: string; name: string }[]) => { const m = new Map<string, number>(); for (const x of xs) { const t = x.name.replace(/: [^:]*$/, ""); m.set(t, (m.get(t) ?? 0) + 1); } return [...m].map(([t, n]) => `${quote(t)} (${fmt(n)})`); };
  const added = kept(d.findings.added), gone = kept(d.findings.gone);
  const titledFinding = (x: { name: string }) => { const i = x.name.lastIndexOf(": "); return i < 0 ? x.name : `${quote(x.name.slice(0, i))} at ${x.name.slice(i + 2)}`; };
  if (added.length) {
    const serious = added.some((x) => b.findings.some((f) => `${f.pack}/${f.rule}@${f.at}` === x.id && f.severity === "error"));
    items.push({ text: `New problems in ${list(areas(added))}: ${serious ? "the design does not pass until they are fixed" : "none stops the design passing, but each is work to plan for"}`, tone: serious ? "fail" : "warning" });
    notes.push(sentence(`${count(added.length, "new problem")}, by check: ${list(byRule(added), { max: 6 })}`), sentence(`New problems: ${list(added.map(titledFinding), { max: 6 })}`));
  }
  if (gone.length) {
    items.push({ text: `Problems fixed in ${list(areas(gone))}, so less now stands in the way`, tone: "pass" });
    notes.push(sentence(`${count(gone.length, "finding")} gone, by rule: ${list(byRule(gone), { max: 6 })}`));
  }
  // Changes in the checks, kept apart: a new rule finding what was already there is not the design getting worse.
  const ch = d.checks;
  if (ch && (ch.rulesAdded.length || ch.rulesRemoved.length)) {
    const ruleTitle = (k: string) => { const [pk, ...r] = k.split("/"); return b.instance.packs.find((p) => p.name === pk)?.rules.find((x) => x.id === r.join("/"))?.title ?? k; };
    items.push({ tone: "info", text: ch.findingsAdded.length ? "The checks themselves changed: new checks found problems that were already there, so this is not the design getting worse" : "The checks themselves changed; the design did not get worse because of it" });
    if (ch.rulesAdded.length) notes.push(sentence(`New checks: ${list(ch.rulesAdded.map((k) => quote(ruleTitle(k))), { max: 6 })}, with ${count(ch.findingsAdded.length, "finding")}`));
    if (ch.rulesRemoved.length) notes.push(sentence(`Checks no longer run: ${list(ch.rulesRemoved, { max: 6 })}, taking ${count(ch.findingsGone.length, "finding")} with them`));
  }
  if (a.rules && b.engine.rules && a.rules !== b.engine.rules) notes.push(sentence(`Rule set ${a.rules} then, ${b.engine.rules} now${a.engineVersion && a.engineVersion !== b.engine.version ? `; engine ${a.engineVersion} then, ${b.engine.version} now` : ""}`));
  if (a.owners && b.teams) {
    const un = b.teams.unassigned.reduce((n, g) => n + g.open, 0), up = b.teams.unownedParts.length;
    if (a.owners.unownedParts !== up || a.owners.unassignedUnits !== un) {
      const better = up + un < a.owners.unownedParts + a.owners.unassignedUnits;
      items.push({ text: better ? "More of the system and the work now has an owner team" : "More of the system or the work is without an owner team than before", tone: better ? "pass" : "warning" });
      notes.push(sentence(`Parts with no owner team: ${fmt(a.owners.unownedParts)} then, ${fmt(up)} now; open units with none: ${fmt(a.owners.unassignedUnits)} then, ${fmt(un)} now`));
    }
  }
  const patchTitle = (id: string) => b.patches.find((p) => p.id === id)?.title ?? id;
  if (d.patches.decided.length) { items.push({ text: `Decided: ${list(d.patches.decided.slice(0, 2).map((p) => `${quote(patchTitle(p.id))}, ${p.to}`))}${d.patches.decided.length > 2 ? " and others" : ""}` }); notes.push(sentence(`Decided: ${list(d.patches.decided.map((p) => `${p.id} ${p.to}`), { max: 6 })}`)); }
  if (d.patches.added.length) { items.push({ text: `Proposed: ${list(d.patches.added.slice(0, 2).map((p) => quote(patchTitle(p.id))))}${d.patches.added.length > 2 ? " and others" : ""}` }); notes.push(sentence(`New proposed changes: ${list(d.patches.added.map((x) => x.id), { max: 6 })}`)); }
  if (d.claims.regraded.length) { items.push({ text: `What we know changed: ${list(d.claims.regraded.slice(0, 2).map((x) => `${quote(x.name)} is now ${GRADE_WORD[x.to]?.toLowerCase() ?? x.to}`))}`, tone: "info" }); notes.push(sentence(`Regraded: ${list(d.claims.regraded.map((x) => `${x.id} ${x.from} to ${x.to}`), { max: 6 })}`)); }
  if (d.notes.answered.length) { items.push({ text: "Open questions have been answered" }); notes.push(sentence(`${count(d.notes.answered.length, "question")} answered: ${list(d.notes.answered.map((x) => x.id), { max: 6 })}`)); }
  const REC: Record<string, string> = { element: "part", relationship: "relationship", unit: "unit", claim: "claim" };
  const recKinds = Object.entries(d.counts).filter(([k, x]) => REC[k] && x.added + x.removed + x.changed);
  const churn = DIGEST.churnText(d, since.importer);
  const structural = recKinds.some(([, x]) => x.added + x.removed + x.changed);
  if (churn && !structural) items.push({ tone: "info", text: churn.replace(/[.\s]+$/, "") });
  else if (recKinds.length) {
    // when the importer may account for some of it, the slide says so rather than calling it all a revision
    items.push({ tone: "info", text: churn ? `The design and the plan were revised. ${churn.replace(/[.\s]+$/, "")}` : "The design and the plan were revised" });
    notes.push(sentence(`Model and plan: ${list(recKinds.map(([k, x]) => `${count(x.added + x.removed + x.changed, REC[k])} (${fmt(x.added)} added, ${fmt(x.removed)} removed, ${fmt(x.changed)} changed)`))}`));
  }
  const empty = DIGEST.isEmpty(d) && !items.length;
  // a report from before status was recorded says so on the slide itself, not only in the notes
  const noStatus = d.status ? "" : " That report recorded no status, so no milestone's move can be shown; the next report records it.";
  const lead = (empty ? sentence(`${basis}: nothing has changed`) : sentence(basis)) + noStatus;
  return {
    template: "changes", title, lead, items: items.slice(0, 7),
    notes: [
      sentence(since.basis === "presented" ? "This compares with what the room saw last time; after this meeting, mark this deck as presented so the next one starts from here" : "Nothing has been marked as presented yet; after this meeting, mark this deck as presented (bun plumb.ts report --presented, or the button under the dev server)"),
      ...notes, ...notesOf(s),
    ],
  };
}

/** Risks: each load-bearing untested premise as a bet, in plain words. The counted risks of the build go in the notes. */
function risksSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b, title = String(s.title ?? DEFAULT_TITLES.risks);
  const limit = Number(s.limit) > 0 ? Math.floor(Number(s.limit)) : 3;
  const bets = b.status?.risks ?? [];
  const items: DeckItem[] = bets.slice(0, limit).map((r) => ({ text: r.bet, sub: `${r.ifWrong} ${r.testing}`, tone: "warning", rag: "amber" }));
  const notes: string[] = [];
  if (bets.length) notes.push(sentence(`Untested, and much rests on each, heaviest first: ${list(bets.map((r) => `${r.claim} (${count(claimWeight(b, r.claim), "record")})`), { max: 8 })}`));
  if (bets.length > limit) notes.push(sentence(`Not on the slide: ${bets.slice(limit).map((r) => r.text.replace(/[.\s]+$/, "")).join(" / ")}`));
  // the build's other risks, counted, for the presenter
  const errors = b.findings.filter((f) => f.severity === "error");
  if (errors.length) notes.push(sentence(`The design fails ${count(new Set(errors.map((f) => `${f.pack}/${f.rule}`)).size, "error check")} in ${count(errors.length, "place")}: ${list([...new Set(errors.map((f) => `${f.pack}/${f.rule}`))], { max: 4 })}`));
  const breaking = b.patches.filter((p) => p.status === "proposed" && p.impact.findingsIntroduced.some((f) => f.severity === "error"));
  if (breaking.length) notes.push(sentence(`${share(breaking.length, b.patches.filter((p) => p.status === "proposed").length, "proposed change")} would break a check: ${list(breaking.map((p) => p.id), { max: 3 })}`));
  if (b.teams) {
    const up = b.teams.unownedParts.length, openUnits = uniqueUnits(b).filter((u) => u.status !== "done").length, un = b.teams.unassigned.reduce((n, g) => n + g.open, 0);
    if (up) notes.push(sentence(`${share(up, b.model.elements.length, "part")} have no owner team`));
    if (un) notes.push(sentence(`${share(un, openUnits, "open unit")} ${verb(un, "has", "have")} no owner team`));
    for (const f of b.findings.filter((x) => x.pack === "teams" && x.rule === "team-load")) {
      const l = b.teams.load.find((x) => x.team === f.at);
      if (l) notes.push(sentence(`${quote(teamName(b, f.at))} owns ${share(l.open, openUnits, "open unit")}, over the ${Math.round(b.teams.maxShare * 100)}% this plan allows one team`));
    }
  }
  return {
    template: "risks", title,
    lead: !bets.length ? "No belief that much of the plan rests on is untested."
      : bets.length > limit ? sentence(`The heaviest ${fmt(limit)} of ${fmt(bets.length)} beliefs much of the plan rests on that nothing has proved yet; ${fmt(bets.length - limit)} more are on the Strategy page`)
      : "Each risk is a belief much of the plan rests on that nothing has proved yet: what we are betting, what is in question if we are wrong, and how we are finding out.",
    items, notes: [...notes, ...notesOf(s)],
  };
}

/** Candidate decisions the engine can see, for the speaker notes only: never on the slide. */
export function candidateDecisions(b: Bundle): string[] {
  const out: string[] = [];
  const proposed = b.patches.filter((p) => p.status === "proposed");
  for (const p of proposed.slice(0, 4)) out.push(`accept or reject ${p.id}, ${quote(p.title)}`);
  const lb = loadBearingIds(b).filter((id) => !((b.model.claims ?? []).find((x) => x.id === id)?.attrs?.tested_by));
  if (lb.length) out.push(`decide how to test ${list(lb, { max: 3 })}, untested and load-bearing with no unit testing ${lb.length === 1 ? "it" : "them"}`);
  if (b.teams?.unownedParts.length) out.push(`name owner teams for the ${count(b.teams.unownedParts.length, "part")} with none`);
  const rec = b.tracker?.reconcile;
  if (rec?.ownerDisagreements?.length) out.push(`settle who owns ${list(rec.ownerDisagreements.map((d) => d.unit), { max: 3 })}: the model and ${trackerName(b)} name different teams`);
  if (rec?.counts.proposed) out.push(`confirm or reject ${count(rec.counts.proposed, "likely match", "likely matches")} with ${trackerName(b)}`);
  const oq = (b.notes?.items ?? []).filter((n) => n.kind === "question" && n.status === "open");
  const clip = (t: string) => (t.length > 70 ? t.slice(0, 70).replace(/\s+\S*$/, "") + "…" : t);
  if (oq.length) out.push(`answer ${count(oq.length, "open question")}: ${list(oq.map((n) => quote(clip(n.text.trim()))), { max: 3 })}`);
  return out;
}

function decisionsSlide(c: Ctx, s: Raw): DeckSlide {
  const b = c.b, title = String(s.title ?? DEFAULT_TITLES.decisions);
  const raw = Array.isArray(s.items) ? s.items : [];
  const items: DeckItem[] = [];
  raw.forEach((x, i) => {
    const r = (x && typeof x === "object" && !Array.isArray(x) ? x : { decision: x }) as Raw;
    const text = String(r.decision ?? r.text ?? "").trim();
    if (!text) { c.warn(`deck.yaml slide ${c.n} (decisions): item ${i + 1} has no decision text`); return; }
    for (const ref of strList(r.refs) ?? []) if (!knownRef(b, ref)) c.warn(`deck.yaml slide ${c.n} (decisions): item ${i + 1} refers to ${ref}, which is not in the build`);
    // a decision that names a patch shows its computed verdict beside it, and its words are checked against it
    const patch = (strList(r.refs) ?? []).map((id) => b.patches.find((p) => p.id === id)).find((p) => p?.impact.verdict) ?? patchesNamed(`${text} ${r.why ?? ""}`, b).find((p) => p.impact.verdict);
    const v = patch?.impact.verdict;
    if (v) { const bad = verdictConflict(`${text} ${r.why ?? ""}`, v.level); if (bad) c.warn(`deck.yaml slide ${c.n} (decisions): item ${i + 1} ${bad}`); }
    for (const bad of statusConflicts(`${text} ${r.why ?? ""}`, b)) c.warn(`deck.yaml slide ${c.n} (decisions): item ${i + 1} ${bad}`);
    items.push({ text, ...(r.why != null ? { sub: String(r.why) } : {}), ...(v ? { verdict: { level: v.level, text: v.level === "fail" ? `Breaks ${count(Math.max(1, patch!.impact.findingsIntroduced.filter((x) => x.severity === "error").length), "check")}` : VERDICT_TEXT[v.level] } } : {}) });
  });
  const cands = candidateDecisions(b);
  return {
    template: "decisions", title,
    lead: items.length ? sentence(items.length === 1 ? "One decision is needed from this room" : `This room is asked for ${count(items.length, "decision")}`) : "No decisions are written for this deck yet: they go in deck.yaml, by hand.",
    items,
    notes: [...(cands.length ? ["Candidates the engine sees, for you, not for the slide:", ...cands.map((x) => sentence(x))] : []), ...notesOf(s)],
  };
}

/** The deck, from deck.yaml's slides over the bundle. Warnings name every query that references something missing. */
export function buildDeck(b: Bundle, cfg: DeckConfig): { deck: Deck; warnings: string[] } {
  const warnings: string[] = [];
  const slides: DeckSlide[] = [];
  cfg.slides.forEach((s, i) => {
    const c: Ctx = { b, n: i + 1, warn: (m) => warnings.push(m) };
    const t = String(s.template ?? "") as DeckTemplate;
    // the author's own speaker notes, checked against the build: a status or a verdict it no longer has
    const own = notesOf(s).join(" ");
    if (own) {
      for (const bad of statusConflicts(own, b)) warnings.push(`deck.yaml slide ${i + 1} (${t}) notes: ${bad}`);
      for (const p of patchesNamed(own, b)) { const bad = p.impact.verdict ? verdictConflict(own, p.impact.verdict.level) : undefined; if (bad) warnings.push(`deck.yaml slide ${i + 1} (${t}) notes: ${p.id} ${bad}`); }
    }
    switch (t) {
      case "title": slides.push(titleSlide(c, s, cfg)); break;
      case "thesis": slides.push(thesisSlide(c, s)); break;
      case "status": slides.push(statusSlide(c, s)); break;
      case "changes": slides.push(changesSlide(c, s)); break;
      case "risks": slides.push(risksSlide(c, s)); break;
      case "milestones": slides.push(milestonesSlide(c, s)); break;
      case "challenges": slides.push(challengesSlide(c, s)); break;
      case "path": slides.push(...pathSlides(c, s)); break;
      case "decisions": slides.push(decisionsSlide(c, s)); break;
      default: warnings.push(`deck.yaml slide ${i + 1}: template "${String(s.template ?? "")}" is not one of ${DECK_TEMPLATES.join(", ")}; skipped`);
    }
  });
  if (!slides.length) warnings.push("deck.yaml: no slide could be built");
  return { deck: { title: cfg.title ?? b.instance.title, ...(cfg.subtitle ? { subtitle: cfg.subtitle } : {}), slides }, warnings };
}

