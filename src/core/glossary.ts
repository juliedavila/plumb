// The glossary: one short definition for each word the page uses as a term. Generic terms live here and hold for any
// instance; an instance adds or overrides terms in engine.yaml (`glossary:`), for example what its zones mean. The
// bundle carries the merged list, and the page shows a definition on hover or focus at a term's first use in the
// tour's captions and in each page's section headings (src/site/client/glossary.js). Wording only: the glossary is
// left out of the model hash.

import type { GlossaryTerm, InstanceConfig } from "../types.ts";

type Entry = [term: string, definition: string, forms?: string[]];

/** The engine's own terms, in the order a newcomer meets them. */
export const ENGINE_GLOSSARY: Entry[] = [
  ["part", "One piece of the system: a service, a store, a tool, a person's step or a queue. The model is its parts and the relationships between them."],
  ["relationship", "A line from one part to another: data, control, a hand-off or feedback, with what it carries."],
  ["zone", "A band of the drawing that groups parts by where they sit. Each instance says what its zones mean; a relationship that leaves a band crosses a boundary."],
  ["view", "A drawing of some of the parts, chosen to tell one story. Every view is generated from the model, so it cannot drift from it."],
  ["contract", "A named thing one part hands another, such as a report or a record, with the parts that produce and consume it."],
  ["unit", "One piece of work in the plan, with a done-condition a person can check. A unit changes parts, and needs and provides capabilities.", ["unit", "units", "work unit", "work units"]],
  ["capability", "What a finished unit makes possible, named so other units can need it. A unit can start when every capability it needs comes from a done unit."],
  ["milestone", "A checkpoint where a complete piece of value is delivered, closed by a definition of done a person can check. Its status is red, amber or green, and says why."],
  ["definition of done", "The sentence a person checks to say a milestone is reached: the milestone's \"Reached when\".", ["definition of done", "exit test", "exit tests", "reached when"]],
  ["critical path", "The longest chain of units that must finish one after another. Nothing can shorten the plan below it."],
  ["can start now", "Units whose needs are all met by done work, ranked by how much of the plan waits on each.", ["can start now", "what can start now"]],
  ["path to green", "The open work a milestone needs, with what that work waits on, in the order it can be done."],
  ["owner team", "The team that owns a part. A unit's owner team comes from the parts it changes, unless the unit names its own.", ["owner team", "owner teams"]],
  ["lead", "The person who runs a team, owns delivering a milestone or drives a unit, by name or by role title. A unit's lead is its owner team's lead unless the unit names its own.", ["lead"]],
  ["focus", "Showing one subject's share. A team or a lead picked in the header: each page shows their work and what waits on it, dimming or hiding the rest. A part's focus: its neighbourhood.", ["focus"]],
  ["premise", "A belief the design rests on before it is proven. Each one is graded by its evidence, and everything that rests on it is traced."],
  ["claim", "A statement the design makes: a premise, a conclusion built on premises, or an assumption."],
  ["rationale", "The claims a record rests on: the premises, conclusions and assumptions that must hold for it to make sense, each graded by its evidence.", ["rationale"]],
  ["grade", "How much evidence stands behind a claim: evidence, inference, judgment or untested."],
  ["load-bearing", "Carrying much of the design: enough parts, relationships and units rest on the claim that being wrong would matter."],
  ["rule", "A check the engine runs on every build. A rule that fails reports a finding on each record it fails.", ["rule", "rules", "check", "checks"]],
  ["finding", "What a rule reports about one record: a problem the checks found. An error fails the check; a warning is reported and the build goes on.", ["finding", "findings", "problem", "problems"]],
  ["patch", "A change to the model in one file, written by a person or an agent, and reviewed before it is accepted.", ["patch", "patches", "change review"]],
  ["verdict", "The change review's judgment on a patch: it breaks a check (red), passes but needs a person to review it (amber), or passes (green)."],
  ["override", "A status a person set by hand on a milestone (a manual status), with the reason, the date and who. The computed status stays beside it.", ["override", "overrides", "manual status", "set manually"]],
  ["tracker", "Where teams record their work, such as an issue board. The engine reads an export of it and never writes to it."],
  ["note", "A note or question pinned to a record, written by a person, an agent or the page under the dev server.", ["note", "notes", "question", "questions"]],
  ["hand-off", "A relationship where work passes from one team to another. Each one is a place a change can wait.", ["hand-off", "hand-offs", "handoff", "handoffs"]],
  ["lead time", "The days from a change entering the stream to it running in production: its waits and its work."],
  ["WIP limit", "The most changes a queue may hold at once. A queue with no limit only grows.", ["WIP limit", "WIP limits", "work-in-progress limit"]],
  ["fidelity", "How real a part is today, on the instance's ladder: from none, through a stand-in and an existing tool, to built."],
];

/**
 * The terms a design that imports a shared root, and the portfolio page, add. A lone instance
 * never gets them, so its glossary, and its bundle, stay as 0.3.1 wrote them.
 */
export const GLOSSARY_04: Entry[] = [
  ["shared layer", "The records more than one design uses, kept in one shared file at the root: shared parts, the contracts that cross, every crossing and the seams. No design owns it."],
  ["seam", "Where two designs meet, or a module meets the rest of its design. A seam names who owns it, the checks that must hold across it and what must never cross it."],
  ["crossing", "A relationship whose two ends live in different places: two designs, a design and a shared part, or a module and the rest of its design. One the shared layer holds is declared; any other is reported."],
  ["mark", "Whether a contract or a crossing is security-relevant. The checks set it as a floor; a person may raise it, never lower it.", ["mark", "marks", "marked"]],
  ["exception", "A written decision, with who accepted it and until when, to report an undeclared crossing on a seam as a warning instead of an error. It never softens a security finding."],
  ["estimate", "A number about the organization, such as a team's capacity or the share of its time an activity takes, with who stated or measured it, when, and how sure."],
  ["capacity", "A team's limit on work in progress: the pieces of work it carries at once, design units and tracker items alike.", ["capacity"]],
  ["allowance", "What a team's capacity leaves for design work once keeping the lights on and other streams take their share.", ["allowance"]],
  ["slowdown", "A deliberate, accepted bet to do less of an activity for a while, freeing capacity for design work while a named risk rises.", ["slowdown", "slowdowns", "slowdown bet", "slowdown bets"]],
  ["most contended team", "The team whose open work on the paths to the designs' next milestones, divided by its allowance, is highest.", ["most contended team", "most contended"]],
  ["current state", "Where a part stands today, before the design is built: its level, and whether it stays, changes, is replaced or retires. Agents discover it; a person confirms it.", ["current state"]],
];

/** The default matching words: the term, and its plural. */
export function defaultForms(term: string): string[] {
  const t = term.trim();
  if (/\s(now)$/.test(t)) return [t];
  const last = t.split(/\s+/).pop()!;
  const plural = /(s|x|ch|sh)$/i.test(last) ? `${t}es` : /[^aeiou]y$/i.test(last) ? `${t.slice(0, -1)}ies` : `${t}s`;
  return [t, plural];
}

/**
 * The engine's terms merged with engine.yaml `glossary:`. An instance entry with a term's name (any case) replaces
 * its definition (and its forms, when given); a new name adds a term. Problems are returned, never thrown.
 */
export function glossary(config: InstanceConfig | Record<string, unknown>, opts: { v04?: boolean } = {}): { terms: GlossaryTerm[]; problems: string[] } {
  const entries = opts.v04 ? [...ENGINE_GLOSSARY, ...GLOSSARY_04] : ENGINE_GLOSSARY; // a rooted design and the portfolio page add 0.4's terms
  const terms: GlossaryTerm[] = entries.map(([term, definition, forms]) => ({ term, definition, forms: forms ?? defaultForms(term), source: "engine" }));
  const problems: string[] = [];
  const raw = (config as Record<string, unknown>).glossary;
  if (raw == null) return { terms, problems };
  if (typeof raw !== "object" || Array.isArray(raw)) return { terms, problems: ["engine.yaml glossary: must be a mapping of term to definition"] };
  for (const [term, v] of Object.entries(raw as Record<string, unknown>)) {
    let definition: string | undefined, forms: string[] | undefined;
    if (typeof v === "string") definition = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = v as Record<string, unknown>;
      if (typeof r.definition === "string") definition = r.definition;
      if (Array.isArray(r.forms)) forms = r.forms.map(String).filter((x) => x.trim());
    }
    if (!definition?.trim()) { problems.push(`engine.yaml glossary: "${term}" has no definition; skipped`); continue; }
    const at = terms.findIndex((t) => t.term.toLowerCase() === term.trim().toLowerCase());
    const entry: GlossaryTerm = { term: at >= 0 ? terms[at].term : term.trim(), definition: definition.trim(), forms: forms?.length ? forms : at >= 0 ? terms[at].forms : defaultForms(term), source: "instance" };
    if (at >= 0) terms[at] = entry; else terms.push(entry);
  }
  return { terms, problems };
}
