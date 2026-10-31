// The portfolio: composition, the lock, seams, exceptions, checks, impact data and the page. `RuleContext.portfolio`
// is set only in a portfolio build, so the portfolio pack's rules run through the existing runner. Load by team
// covers allowance, doing, ready, the relief and slowdown timeline, the most contended team and the distribution.
import type { ComposedDesign, Finding, GlossaryTerm, Mark, Marks, Model, Plan, RagStatus, RootInput, SeamException, Severity } from "../types.ts";

// ---------- portfolio.yaml and the lock ----------

/** portfolio.yaml as read: the designs it composes over one root, and nothing else. It owns no records. */
export interface PortfolioFile {
  path: string;                          // portfolio.yaml, absolute
  dir: string;                           // its folder, absolute: `root` and each design's `from` are relative to it
  schema?: string;
  name: string; title: string;
  root: string;                          // as written
  designs: { namespace: string; from: string }[];
  presenting: string;                    // "released": presenting composes each design's newest released edition
  working: string;                       // "latest": working composes the working copies
  horizon_months?: number;
}

/** Which view a portfolio build composes: the working copies, or each design's newest released edition with today's status. */
export type PortfolioMode = "working" | "presenting";

/** One design's line in portfolio.lock. */
export interface LockDesign {
  edition: string;                       // "latest", or the released version composed
  model?: string;                        // the model hash, first 12 hex (a working copy)
  released?: string;                     // a released edition's date
  sha256?: string;                       // a released edition's edition.yaml hash, first 12 hex
  since_release?: { version: string; accepted_patches: number }; // a working copy after a release: the accepted patches since
  note?: string;                         // "no released edition; working copy shown"
}

/** One section of portfolio.lock: what a build of one mode composed. */
export interface LockSection {
  built: string;
  root: { hash: string; shared_sha256?: string; accepted_patches: number };
  designs: Record<string, LockDesign>;
}

/** portfolio.lock: written by `bun plumb.ts portfolio build`, one section per mode, never edited by hand. */
export interface PortfolioLock { working?: LockSection; presenting?: LockSection }

// ---------- seams, crossings and exceptions (src/core/seams.ts) ----------

/**
 * One exception to the seam rule as this build judged it: SeamException (src/core/org.ts reads the list each
 * seam takes and whether each is valid), with its state on the build date. `judged` is false when its end names a
 * milestone of a design this build cannot see: it is taken as in force here, and judged in the portfolio.
 */
export type ExceptionInBuild = SeamException & { state: "in force" | "ended" | "not applied"; judged: boolean };

/** A crossing as the seam rule judges it: a relationship whose ends have different homes, or that crosses a module seam. */
export interface CrossingJudgement {
  id: string;                            // the composed key: "shared:<id>" for the shared layer's, "<ns>:<id>" for a design's own
  rel: string;                           // the relationship's id where it lives: a shared crossing's id, or the design's own id
  home: string;                          // "shared", or the design that holds the relationship
  from: string; to: string;              // composed form
  fromName: string; toName: string;
  kind: string; label?: string;
  carries: string[];                     // composed form
  seams: string[];                       // the keys of the seams it crosses (none for a design's edge to a shared part, unless a seam names that pair)
  declared: boolean;
  declaredBy?: "shared layer" | "module seam";
  why?: string;                          // undeclared: why, in words
  mark?: Mark;                           // absent when no mark derivation is available to this build
  severity?: Severity;                   // undeclared only: error when security-relevant, else warning; an exception in force makes an error a warning
  excepted_by?: string;                  // "org exception on intake:autotriage", "default exception on intake-premerge"
  exception?: ExceptionInBuild;
}

/** A seam with what crosses it: one between two homes (the shared layer), or a module seam inside one design. */
export interface SeamView {
  key: string;                           // the shared seam's id, or "<ns>:<seam id>"
  id: string;
  kind: "shared" | "module";
  design?: string;                       // a module seam's design
  between: string[];                     // namespaces (shared), or the module seam's sides as written
  name?: string;
  owner_role?: string;
  checks?: string[];
  never_cross?: string[];
  crossings: string[];                   // declared crossings' keys
  undeclared: string[];                  // undeclared crossings' keys, security-relevant first
  exceptions: ExceptionInBuild[];
}

/** Everything the seam rule judged in one build. */
export interface SeamReport {
  seams: SeamView[];
  crossings: CrossingJudgement[];        // every crossing judged, declared or not, in key order
  undeclared: CrossingJudgement[];       // the ones the rule reports, security-relevant first
  marksAvailable: boolean;               // false: no mark derivation reached this build, so undeclared crossings count as relevant
  notes: string[];                       // references into designs not composed, skipped
}

// ---------- the portfolio build ----------

/** A finding as the portfolio reports it: `at` is namespaced ("inventory:v01"), and `design` says whose build found it. */
export interface PortfolioFinding extends Finding {
  design?: string;                       // the design whose own build reported it (absent: the portfolio's own, or the root's)
  subject: string;                       // namespaced record ("inventory:v01", "org:vuln-mgmt"), or "<ns> (<what>)" for a design's instance-level finding
  composedOnly?: boolean;                // "found only with the designs composed"
  alsoIn?: string[];                     // designs whose own build reports it too
}

/** One design as a portfolio build composed it. */
export interface PortfolioDesign {
  namespace: string; title: string;
  dir: string;                           // its folder, relative to the portfolio's
  from: string;                          // as portfolio.yaml writes it
  edition?: string;                      // the released edition composed; absent: the working copy
  editionDate?: string; editionSha256?: string;
  label: string;                         // "working copy", "1.0.0, released 2026-10-28", "no released edition; working copy shown"
  root?: string;                         // the root it names, relative to the portfolio's folder; absent when it names none
  modelHash?: string;
  sinceRelease?: { version: string; accepted_patches: number };
  counts: { errors: number; warnings: number };
}

/** What `bun plumb.ts portfolio build` writes as portfolio.json, and what `check` and `impact` read. */
export interface PortfolioData {
  premiseLinks?: import("./premise-links.ts").PremiseLinks;
  engine: { version: string; built: string };
  portfolio: { name: string; title: string; mode: PortfolioMode; root: string; horizon_months?: number; file: string };
  designs: PortfolioDesign[];
  findings: PortfolioFinding[];          // every finding once: the designs' own builds, the composed checks and the portfolio's own
  seams: SeamReport;
  marks?: Marks;
  notes: string[];
  lock: LockSection;
  stopped?: boolean;                     // a design's schema stopped the build: only that finding is reported
  load?: LoadFacts;                      // load by team, when the root has an org layer
}

/** A root patch's effect on the portfolio (`bun plumb.ts portfolio impact`). */
export interface PortfolioImpact {
  patch: string; title: string; status: string; file: string;
  verdict: { level: "fail" | "caution" | "pass"; reasons: string[] };
  introduced: PortfolioFinding[];
  resolved: PortfolioFinding[];
  effect: string;                        // in words: what moves for each team whose numbers change, else the findings it adds and resolves
  teams?: TeamLoadDelta[];               // the teams whose allowance or free slots it changes
}

/** Set only in a portfolio build: every design composed, the root loaded once, and what the seam rule judged. */
export interface PortfolioContext {
  name?: string;
  designs: ComposedDesign[];             // every design composed, with its compiled records
  mode?: PortfolioMode;
  root?: RootInput;                      // the portfolio's root, loaded once
  rootWritten?: string;                  // portfolio.yaml root:, as written
  roots?: Record<string, { dir?: string; written?: string }>; // each design's root: its folder (absolute) and engine.yaml root: as written; empty when it names none
  seams?: SeamReport;
  marks?: Marks;
  composed?: { model: Model; plan: Plan }; // every design and the shared layer as one namespaced graph
  load?: LoadFacts;                      // load by team across the designs (src/core/capacity.ts): what team-over-capacity reads
}

// ---------- load by team (src/core/capacity.ts) ----------
//
// Capacity is a WIP limit: the pieces of work a team carries in doing at once, design units and tracker items alike.
// Its activities (keeping the lights on, other value streams) take a share of it; what is left is its allowance for
// design work. Units in doing across every design take the allowance. Every number here is for the page and
// the checks to read; nothing in it is written back to a file.

/** Where a unit's flow item comes from: an imported edition's default, the design's own plan, or progress.yaml ("set here"). */
export type FlowItemSource = "default" | "plan" | "set";

/** One unit of a composed design, as the load views name it. */
export interface LoadUnit {
  id: string;                            // composed: "<ns>:<id>"
  design: string;                        // its design's namespace
  title: string;
  milestone: string;                     // composed: "<ns>:<phase id>"
  status: "todo" | "doing" | "done";
  owners: string[];                      // its owner teams, composed ("org:vuln-mgmt"); a unit with several takes a slot on each
  flow?: { item?: string; source: FlowItemSource; plan?: string }; // plan: the plan's value where progress.yaml sets another
  transition?: boolean;                  // transition work: it moves a part whose disposition is transition, replace or retire, or moves a part to retired
  discovered?: boolean;                  // transition work only because of a disposition nobody has confirmed
  ready?: boolean;                       // open, not in doing, and every capability it requires is available: it can start now
  onPath?: string;                       // open and on the path to its design's current milestone: that milestone, composed
}

/** A design's current milestone (the first not reached) and the open work on its path (status.ts pathOf, across designs). */
export interface DesignPath {
  design: string; title: string;
  milestone?: string;                    // composed; absent when every milestone is reached
  name?: string; target?: string;
  units: string[];                       // open units on its path, composed, in plan order (another design's work it waits on included)
  reached: string[];                     // its milestones reached, composed
}

/** What brings an activity's share down, as this build reads it: landed now, or when it would land "if on target". */
export interface ReliefFacts {
  at: string;                            // the unit or milestone, composed, as the org layer names it
  kind: "unit" | "milestone" | "unknown"; // unknown: its design is not composed, or holds no such record
  name?: string;                         // the unit's title or the milestone's name
  design?: string; milestone?: string; milestoneName?: string; target?: string;
  effect: "retire" | "reduce"; to: number;
  landed: boolean;                       // the unit is done, or the milestone reached
  reachedOn?: string;                    // when it landed, where progress.yaml says: the last done date of the work
  date?: string;                         // when it lands in the projection: its milestone's target ("if on target")
  undated?: string;                      // why its return cannot be dated, in words
}

/** One activity's share as written and in force today, its reliefs and slowdowns, and the payoff once a relief has landed. */
export interface ActivityLoad {
  activity: string;                      // "org:<id>"
  name: string; team: string; teamName: string;
  type: "bau" | "stream"; flow_item?: string;
  share?: number;                        // as org.yaml and the accepted root patches write it; absent: not stated
  now: number;                           // in force today, reliefs and slowdowns applied
  slots?: number;                        // now × the team's capacity
  why: string[];                         // what brought it below what is written, in words
  reliefs: ReliefFacts[];
  slowdowns: string[];                   // its slowdowns, "org:<id>"
  manual_work?: string;                  // the kind of manual work it links, "shared:<id>"
  measured?: { value: number; as_of: string; confidence: string };  // the latest measure (EstimateFacts.measured)
  payoff?: { projected: number; measured: number; landed: boolean; after: string[]; text: string }; // once a relief has landed: projected against measured
}

/** A change in a team's standing load: a relief landing, a slowdown starting or ending. */
export interface LoadEvent {
  kind: "relief" | "slowdown-start" | "slowdown-end";
  activity: string; name: string;
  at?: string;                           // a relief's unit or milestone, composed
  slowdown?: string;                     // "org:<id>"
  date?: string;                         // absent: it cannot be dated (the "No date" column)
  ifOnTarget?: boolean;                  // it rests on a milestone landing on its target
  from: number; to: number;              // the activity's share before and after
  text: string;
}

/** A team's standing load from today to the horizon: steps where it changes, month by month, and what cannot be dated. */
export interface LoadTimeline {
  steps: { from: string; standing: number; allowance?: number; shares: Record<string, number>; events: LoadEvent[] }[];
  months: { month: string; standing: number; allowance?: number }[]; // the level at each month's end, this month to the horizon
  undated: LoadEvent[];
}

/** One team: its limit, what its activities take, its allowance, the work it carries and the queue behind it. */
export interface TeamLoad {
  team: string;                          // "org:<id>"
  name: string; lead?: string;
  capacity?: number;                     // the WIP limit in force; absent: capacity not stated
  shares: { activity: string; name: string; type: "bau" | "stream"; share: number; slots?: number; why: string[] }[]; // in force today
  standing: number;                      // the sum of its shares in force today
  allTaken: boolean;                     // its shares reach 1: keeping the lights on and other streams take all of its capacity
  allowance?: number;                    // capacity × (1 − standing), never below 0
  doing: string[];                       // units in doing, every design, whose owner teams include it
  doingBy: { design: string; units: number; transition: number; discovered: number }[];
  ready: string[];                       // open units it owns that can start now: the queue behind the limit
  onPath: string[];                      // its open units on the paths to the designs' current milestones
  free?: number;                         // allowance − doing; below 0, the overrun
  over: boolean;
  severity?: Severity;                   // team-over-capacity: error when it owns work on a path, else warning
  contention: { rank: number; open: number; ratio?: number; basis: "allowance" | "no allowance" | "work alone" | "nothing on a path" };
  unclassified?: { share: number; slots?: number; as_of: string; file: string }; // the latest measure's unclassified time: shown apart, never counted in the allowance
  calibration?: { text: string; verdict?: string; proposed?: number }; // the latest measure's flow calibration, read against the limit
  timeline: LoadTimeline;
  text: string;                          // its load now, in one or two sentences
}

/** A deliberate slowdown, as the page shows the bet. */
export interface SlowdownBet {
  id: string;                            // "org:<id>"
  activity: string; activityName: string; team: string; teamName: string;
  what: string;
  state: "running" | "not started" | "ended" | "not applied";
  from: string; until: string; untilName?: string; untilTarget?: string; max_until?: string;
  share?: number;                        // the share it slows, as it stands without it today
  during?: number;
  frees?: number;                        // (share − during) × capacity, in slots
  risk: { rises: string; refs: string[]; level?: string };
  accepted_by: string[]; accepted_at: string; review_by?: string;
  flags: string[];                       // org/slowdown-overdue and org/slowdown-valid, in words
  text: string;
}

/** Open units by flow item and design, each team's activities beside them, and how many values are still defaults. */
export interface FlowDistribution {
  items: string[];                       // feature, defect, risk, debt
  designs: { design: string; title: string; open: number; by: Record<string, number>; defaults: number; set: number; missing: number }[];
  teams: { team: string; name: string; by: Record<string, { count: number; share: number; slots?: number }> }[];
  totals: { units: Record<string, number>; activities: Record<string, number>; open: number; defaults: number; set: number; missing: number };
  text: string;
}

/** A kind of manual work: the activities that link it and every unit, in every design composed, that relieves it. */
export interface ManualWorkLoad {
  kind: string;                          // "shared:<id>"
  name: string; flow_item?: string;
  activities: string[];                  // "org:<id>"
  units: { unit: string; design: string; title: string; status: string; effect: string; rests_on?: string; grade?: string; linked: boolean }[];
}

/** The team whose open work on the paths to the designs' next milestones, divided by its allowance, is highest. */
export interface ContendedTeam {
  team: string; name: string;
  open: number; allowance?: number; ratio?: number;
  basis: TeamLoad["contention"]["basis"];
  units: { unit: string; title: string; design: string; milestone: string; milestoneName?: string }[];
  next: { team: string; name: string; ratio?: number; open: number; basis: TeamLoad["contention"]["basis"] }[];
  text: string;
}

/** Load by team across the designs a portfolio composes. */
export interface LoadFacts {
  today?: string;
  horizon: { months: number; to?: string };
  rule: string;                          // the most contended team's rule, in one line
  units: Record<string, LoadUnit>;
  paths: DesignPath[];
  teams: TeamLoad[];                     // the most contended first
  contended?: ContendedTeam;
  activities: ActivityLoad[];
  slowdowns: SlowdownBet[];
  distribution: FlowDistribution;
  manualWork: ManualWorkLoad[];
  counts: { teams: number; stated: number; over: number; overOnPath: number; slowdownsRunning: number };
  notes: string[];
}

/** A team's numbers before and after a root patch, and the sentence the impact says about them. */
export interface TeamLoadDelta {
  team: string; name: string;
  before: { allowance?: number; doing: number; free?: number; over: boolean };
  after: { allowance?: number; doing: number; free?: number; over: boolean };
  text: string;
}

// Additive fields on the engine's shared types (src/types.ts).
declare module "../types.ts" {
  /** The design's shared root as loaded, in a rooted design's own build: the seam rule reads its shared seams and exceptions. (RuleContext.root is RootCheck, set only where the root itself is checked.) */
  interface RuleContext { rootInput?: RootInput }
  /** A pack whose rules read across records: the portfolio also runs it over the composed graph. generic and security always are. */
  interface RulePack { composable?: boolean }
  /** The seam rule's finding: the exception in force that made an error a warning. */
  interface Finding { excepted_by?: string }
}

// ---------- the portfolio page ----------
//
// `bun plumb.ts portfolio build` writes the page from portfolio.json: PortfolioData with `page`, the facts only the page
// reads (the roadmap rows, the seams as sentences, every estimate with its trend, the root's patches with their
// verdicts, and the focus across designs). The render is a pure function of that JSON. A design page built inside the
// portfolio carries `bundle.portfolio`: how the page is labelled, where the portfolio page and the other designs' pages
// are, and the focus they share.

/** The words a page built inside a portfolio says about what it shows. */
export interface ModeWords {
  mode: PortfolioMode;
  head: string;                          // "Working copy", or "Presenting released editions"
  line: string;                          // the header's line: the head and what it means, with the date of the status
}

/** One design as a page inside the portfolio links it. */
export interface PortfolioDesignLink {
  namespace: string; title: string;
  href: string;                          // its page, relative to the page holding the link
  label: string;                         // "Findings intake: working copy, 2 accepted patches since 1.0.0", "Pre-merge checks 1.0.0 (28 Oct)"
}

/** A focus the portfolio offers: a team (org teams "org:<id>"; a design's own team "<ns>:<id>") or a lead (its key: trimmed, lower case). */
export interface PortfolioFocusOption { kind: "team" | "lead"; id: string; name: string }

/** What a design page built inside a portfolio carries (bundle.portfolio). Absent on a lone or a design's own page. */
export interface PortfolioContext {
  name: string; title: string; mode: PortfolioMode;
  href: string;                          // the portfolio page, relative to this design's page
  namespace: string;                     // this design's namespace
  label: string;                         // this design's label (PortfolioDesignLink.label)
  modeLine: string;                      // "Working copy · Findings intake: working copy, ..." or "Presenting released editions · ... · status as of 16 Nov"
  designs: PortfolioDesignLink[];        // every design of the portfolio, this one included, hrefs relative to this page
  focusKey: string;                      // localStorage key the portfolio page and its design pages share: "de-focus:portfolio:<name>"
  focus: { teams: PortfolioFocusOption[]; leads: PortfolioFocusOption[] }; // the portfolio's options, so a focus set there stays valid here
}

/** A milestone on the roadmap: where it sits in time, its status, and the capacity it brings back. */
export interface RoadmapMilestone {
  id: string;                            // composed: "<ns>:<phase id>"
  design: string; name: string;
  target?: string;                       // ISO date
  month?: string;                        // YYYY-MM of an open target, including past months; absent when undated, reached or beyond the horizon
  late?: boolean;                        // its target has passed and it is not reached
  beyond?: boolean;                      // its target lies past the horizon
  status?: RagStatus; statusWhy?: string;// its status (an override where one is set) and the first reason
  manual?: boolean;                      // a person set the status
  reached: boolean; current: boolean;
  delivers?: string; lead?: string;
  open: number; total: number;           // open units in it, and all of them
  reliefs: { team: string; teamName: string; activity: string; activityName: string; slots?: number; landed: boolean; ifOnTarget: boolean; text: string }[];
  href: string;                          // its card on the design's page, relative to the portfolio page
}

/** One unit of a design waiting on another design's unit, through a capability the shared layer declares. */
export interface CrossWait {
  unit: string; title: string; design: string;       // the waiting unit, composed
  on: string; onTitle: string; onDesign: string;     // the providing unit, composed
  capability: string; done: boolean;                 // the provider is done: the wait is over
  text: string;
}

/** A design's row on the roadmap. */
export interface RoadmapRow {
  design: string; title: string; label: string; href: string;
  edition?: string;
  status?: RagStatus; statusText?: string;
  counts: { errors: number; warnings: number; units: number; done: number };
  milestones: RoadmapMilestone[];
  waits: CrossWait[];
}

/** A crossing as the Seams section says it. */
export interface SeamCrossingView {
  id: string;                            // composed key
  text: string;                          // one sentence, names only
  relevant: boolean;
  why: string;                           // what derives the mark, or who raised it, in words
  carries: string[];                     // contract names, without namespaces
  ends: string[];                        // composed ids of its two ends
  declared: boolean;
  severity?: Severity;
  excepted?: string;                     // in words: the exception that made it a warning
}

export interface SeamExceptionView { contracts: string[]; acceptedBy?: string; until?: string; untilText: string; why?: string; source: "default" | "org"; state: string; text: string }

/** One seam on the page: its sides, its owner, what crosses it, its exceptions and what is undeclared. */
export interface SeamPageView {
  key: string; name: string; kind: "shared" | "module";
  sides: string[];                       // titles
  ownerRole?: string; ownerTeams: { id: string; name: string }[];
  checks: string[];                      // rule titles that must hold across it
  neverCross: string[];                  // contract names
  crossings: SeamCrossingView[];
  undeclared: SeamCrossingView[];        // security-relevant first
  exceptions: SeamExceptionView[];
}

/** An org number as the Estimates table shows it. */
export interface EstimateRow {
  record: string; field: string;         // "org:vuln-mgmt", "capacity"
  team?: string; teamName?: string;
  what: string;                          // "Capacity", "Share: Manual vulnerability triage and validation", "Share during the slowdown"
  unit: "slots" | "share";
  value?: number; valueText: string;     // "3 slots", "34%"
  provenance: string;                    // one line: how it was stated or measured, when, how sure
  age?: number; stale: boolean;
  trend: { as_of: string; value: number; source: string; kind: "value" | "measured" | "stated" }[];
  measured?: { value: number; text: string };
  gap?: { over: boolean; text: string };
  pending: { patch: string; text: string }[];
  rowOwner?: { owner: string; statedByOwner: boolean };
  payoff?: { text: string; landed: boolean }; // an activity's share once a relief has landed: projected beside measured
  problems: string[];
}

/** A root patch on the page: proposed ones with the portfolio's verdict and effect, then the accepted ones. */
export interface RootPatchView {
  id: string; title: string; status: string; why?: string;
  by: string; agent: boolean; created?: string;
  decision?: { by: string; at: string; reason?: string };
  verdict?: { level: "fail" | "caution" | "pass"; reasons: string[] };
  effect?: string;
  ops: string[];                         // what it changes, in words
}

/** What a focus covers across the designs: focusFacts run per design over its bundle, merged by design. */
export interface PortfolioFocusFacts {
  kind: "team" | "lead"; id: string; name: string;
  teams: string[];                       // the teams in focus: the team, or every team the lead leads
  units: Record<string, string>;         // composed unit id -> its relation in words ("owns", "leads; owns, inherited from ...")
  waiting: string[];                     // open units waiting on their work, composed
  parts: string[];                       // composed part ids: their own parts and shared parts their teams hold
  milestones: Record<string, string>;    // composed milestone id -> their share of it, in words
  designs: Record<string, { units: number; milestones: number }>;
  findings: string[];                    // the page's finding keys that touch their records
}

/** Everything the portfolio page reads beyond PortfolioData. */
export interface PortfolioPageFacts {
  today: string;                         // the build date, YYYY-MM-DD
  mode: ModeWords;
  sentence: string;                      // the opening sentence
  designs: PortfolioDesignLink[];        // hrefs relative to the portfolio page
  roadmap: { months: string[]; rows: RoadmapRow[]; noDate: boolean };
  seams: SeamPageView[];
  stalePins: { design: string; text: string }[];
  composedOnly: { key: string; text: string }[];
  estimates: EstimateRow[];
  patches: RootPatchView[];
  findings: { key: string; pack: string; rule: string; title: string; why?: string; severity: Severity; subject: string; subjectName: string; text: string; design?: string; composedOnly?: boolean; excepted?: string }[];
  rules: { key: string; title: string; why: string; severity: string }[]; // every rule the findings name, for the Checks section
  notes: { id: string; kind: string; status: string; text: string; answer?: string; author: string; created: string; target: string; targetName: string }[]; // the root's notes, read-only here
  focus: { key: string; options: { teams: PortfolioFocusOption[]; leads: PortfolioFocusOption[] }; facts: Record<string, PortfolioFocusFacts> }; // facts keyed "<kind>:<id>"
  glossary: GlossaryTerm[];
}

declare module "../types.ts" {
  /** portfolio.json as the page build writes it: the facts the page reads. */
  interface PortfolioData { page?: PortfolioPageFacts }
  /** A design page built inside a portfolio: its label, the portfolio's page and the other designs' pages, the shared focus. */
  interface Bundle { portfolio?: PortfolioContext }
}
