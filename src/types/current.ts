// Current state: current.yaml records, the retired level and transition work. src/types.ts re-exports this file;
// additions to its shared interfaces are declared below through module augmentation.
//
// current.yaml is a design's live state, like progress.yaml: never written by an importer and never frozen into an
// edition. It holds one record per part: the ladder level the part stands at today (baseline), what happens to it
// (disposition), the part that takes over (replaced_by), and for a part that exists only today, the part itself
// (add). The investigation pod writes a record with `found` alone, which makes it discovered; a person confirms it
// with `confirmed: { by, at }`. src/core/current.ts reads, resolves and checks it.
import type { ComposedDesign, Finding, Rule } from "../types.ts";

/** What happens to a part: new (does not exist yet), retain, transition (exists and changes to meet the target), replace (replaced_by takes over), retire (goes away). */
export type Disposition = "new" | "retain" | "transition" | "replace" | "retire";

/** Who found a record, from what, when, and how sure: written by the investigation pod (by: "agent:<name>") or a person. */
export interface CurrentFound { by?: string; from?: string; as_of?: string; confidence?: string; [key: string]: unknown }
/** A person's confirmation: who and when (YYYY-MM-DD). Written by hand, or by Claude on a person's word, naming the person. */
export interface CurrentConfirmed { by?: string; at?: string; [key: string]: unknown }
/** A part that exists only today, as current.yaml's `add:` declares it: the fields of a part. */
export interface TodayOnlyPart { name?: string; kind?: string; system?: string; zone?: string; owner?: string; verifier?: string; description?: string; [key: string]: unknown }

/** One record of current.yaml as written, its values as text (dates as YYYY-MM-DD). `part` is its key. */
export interface CurrentRecord {
  part: string;
  baseline?: string; disposition?: string; replaced_by?: string;
  add?: TodayOnlyPart;
  found?: CurrentFound; confirmed?: CurrentConfirmed;
  problems?: string[];                   // shape problems found while reading (a record or a field that is not a mapping), in words
  unread?: boolean;                      // the record is not a mapping: nothing of it is read
  addUnread?: boolean;                   // its add: is not a mapping, so no part that exists only today comes of it
}

/** current.yaml as loaded, from the instance folder (never an edition's). `problem`: the file does not read, so no record is. */
export interface CurrentInput { file: string; records: CurrentRecord[]; problem?: string }

/** A record as the build reads it: its part and replacement in canonical form, and whether a person confirmed it. */
export interface CurrentState {
  part: string;                          // the part, canonical (a design's own part: its bare id)
  name: string;                          // the part's name, for sentences
  baseline: string;                      // the ladder level it stands at today
  baselineDefault?: boolean;             // not written: the ladder's first level
  disposition?: Disposition;             // absent when the record's disposition is missing or unknown (core/current-valid)
  replaced_by?: string;                  // canonical: own bare, a shared part "shared:<id>", another design's "<ns>:<id>"
  todayOnly?: boolean;                   // declared with add: a part that exists only today
  found?: { by: string; agent?: string; from?: string; as_of?: string; confidence?: string }; // agent: the agent's name when `by` names one
  confirmed?: { by: string; at: string };
  refused?: string;                      // why a written confirmation does not count ("an agent wrote it"), in words
  state: "discovered" | "confirmed";
  text: string;                          // its provenance in one sentence: "Discovered by current-state-scout from the scheduler's job list, 27 Oct; not confirmed."
}

/**
 * Transition work: a unit that moves a part whose disposition is transition, replace or retire, or
 * moves any part to retired. Every other unit is target-design work. `discovered`: the units whose only reason to
 * count is a disposition nobody has confirmed, so a count that rests on them can say so.
 */
export interface TransitionWork { units: string[]; doing: string[]; discovered: string[] }

/** How a replaced or retired part's retirement stands, for the part page and the rule. */
export interface Retirement {
  part: string;
  by: string[];                          // units that move it to retired, earliest milestone first
  milestone?: string;                    // the first retiring unit's milestone
  replacement?: {
    part: string;                        // canonical
    level?: string;                      // the highest level any unit moves it to
    units: string[];                     // the units that bring it to that level, earliest first ("<ns>:<id>" in another design)
    milestone?: string;                  // the milestone where it first reaches that level ("<ns>:<id>" in another design)
    design?: string;                     // the namespace of the design that does it, when it is not this one
    target?: string;                     // that milestone's target date, across designs
  };
  order?: "same" | "before" | "after" | "unknown"; // the first retiring milestone against the replacement's ("after": the old part outlives it; "unknown": a date is missing, across designs)
  waitsFor?: string[];                   // retiring units that wait, directly or through others, for a unit that brings the replacement to its level
  doesNotWait?: string[];                // retiring units that do not, so the old part could go first
}

/** What the build knows about current state: its records, the findings of core/current-valid, transition work. */
export interface CurrentCompiled {
  records: CurrentState[];
  findings: Finding[];
  transition: TransitionWork;
}

/** The context the plan pack's current-state rules read (plan/fidelity-moves-up, plan/retire-before-replace). */
export interface CurrentFacts {
  records: Map<string, CurrentState>;    // by canonical part id
  ladder: string[];
  own?: string;                          // this design's namespace
  compose?: ComposedDesign[];            // other designs composed with this one: their plans order a replacement across designs
}

/** The bundle's current state, for the page, the brief and load calculations. */
export interface BundleCurrent {
  file: string;
  records: CurrentState[];               // by part id
  retirements: Retirement[];             // one per part whose disposition is replace or retire
  transition: TransitionWork;
  counts: { records: number; discovered: number; confirmed: number; todayOnly: number };
}

/** The level a unit moves a part to when it retires it: terminal, outside the ladder. */
export type RetiredLevel = "retired";

declare module "../types.ts" {
  /** current.yaml, read for a 0.4 design (a lone instance has none). */
  interface Instance { current?: CurrentInput }
  /** A part that exists only today (current.yaml `add:`), brought into the compiled model so units can retire it. */
  interface Element { todayOnly?: boolean }
  /** Set for a 0.4 design whose current.yaml has records. */
  interface RuleContext { current?: CurrentFacts }
  interface Bundle { current?: BundleCurrent }
  /**
   * Rules a pack adds for a 0.4 design only; a lone instance keeps its original rule set. A rule here
   * with a base rule's id replaces that rule for a 0.4 design (src/core/rules.ts `packsFor`).
   */
  interface RulePack { rules04?: Rule[] }
}
