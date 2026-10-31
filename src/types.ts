// The shared contract for the Plumb. Core, packs, site and MCP all build to these types.
// See SPEC.md for the data contract.

export type Attrs = Record<string, unknown>;

export interface Team { id: string; name: string; description?: string }
export interface System { id: string; name: string; description?: string }
export interface Zone { id: string; name: string; description?: string }

export interface Element {
  id: string; name: string; kind: string;
  system?: string; zone?: string; owner?: string; parent?: string;
  description?: string; attrs?: Attrs;
}

export interface Relationship {
  id: string; from: string; to: string; kind: string;
  label?: string; carries?: string[]; optional?: boolean; attrs?: Attrs;
}

export interface Contract {
  name: string; description?: string;
  produced_by?: string[]; consumed_by?: string[]; attrs?: Attrs;
}

export interface View { id: string; title: string; elements: string[]; relationships?: string[] }

export interface Model {
  teams: Team[]; systems: System[]; zones: Zone[];
  elements: Element[]; relationships: Relationship[]; contracts: Contract[]; views: View[];
}

export interface Phase { id: string; name: string; exit_test: string; order: number }

export interface FidelityMove { id: string; from: string; to: string }

export type UnitStatus = "todo" | "doing" | "done";

export interface Unit {
  id: string; title: string; kind: string; phase: string;
  elements?: FidelityMove[]; requires?: string[]; provides?: string[];
  check: string; owner?: string; feedback?: string; status?: UnitStatus; attrs?: Attrs;
}

export interface Plan { phases: Phase[]; units: Unit[] }

export type RecordKind = "element" | "relationship" | "contract" | "team" | "system" | "zone" | "unit" | "phase" | "view" | "claim";

export type PatchOp =
  | { op: "add"; kind: RecordKind; value: Record<string, unknown> }
  | { op: "modify"; kind: RecordKind; id: string; set: Record<string, unknown> }
  | { op: "remove"; kind: RecordKind; id: string };

export type PatchStatus = "proposed" | "accepted" | "rejected";

export interface Patch { id: string; title: string; status: PatchStatus; why: string; ops: PatchOp[]; file?: string }

export interface InstanceConfig {
  name: string; title: string; description?: string;
  packs: string[];
  ladder?: string[]; // fidelity levels, lowest first; default ["none", "stand-in", "existing-tool", "built"]
  [key: string]: unknown; // pack settings, e.g. flow: { max_handoffs: 4 }
}

export interface Instance {
  dir: string; config: InstanceConfig; model: Model; plan: Plan; patches: Patch[];
  loadFindings?: Finding[]; // problems found while reading the instance (a patch file that does not parse, an unknown status, duplicate patch ids)
}

// ---------- rules ----------

export type Severity = "error" | "warning";

export interface Finding {
  pack: string; rule: string; severity: Severity;
  at: string;            // the id the finding sits on (element, relationship, contract name, unit, phase, view)
  atKind: RecordKind | "instance" | "note";
  message: string;
}

/** Additive: the message with record ids replaced by names, for the page (src/core/reader.ts); absent when it names no id. */
export interface Finding { text?: string }

export interface RuleContext {
  config: InstanceConfig; model: Model; plan: Plan;
  // indexes built once by core
  el: Map<string, Element>; rel: Map<string, Relationship>; con: Map<string, Contract>;
  team: Map<string, Team>; unit: Map<string, Unit>; phase: Map<string, Phase>;
  out: Map<string, Relationship[]>; inn: Map<string, Relationship[]>;
}

export interface Rule {
  id: string; title: string; why: string; severity: Severity;
  check(ctx: RuleContext): Omit<Finding, "pack" | "rule" | "severity">[] ;
}

export interface RulePack { name: string; title: string; description: string; rules: Rule[] }
/** The mechanics of a rule (config keys, files, fields), shown only inside its "How this is checked" disclosure; `why` stays in plain words. */
export interface Rule { how?: string }

// ---------- analysis ----------

export interface PlanAnalysis {
  deps: Record<string, string[]>;        // unit id -> unit ids it depends on
  unblocks: Record<string, string[]>;    // unit id -> unit ids that depend on it
  layers: string[][];                    // pull layers over units not done
  frontier: string[];                    // not done, every dependency done
  blocked: Record<string, { missing: string[]; waitingOn: string[] }>; // capabilities not yet provided by done units, and the units that provide them
  critical_path: string[];
  phases: { id: string; total: number; done: number; complete: boolean }[];
  unprovided: string[];                  // capabilities required that no unit provides
}

export interface Impact {
  patch: string; status: PatchStatus;
  added: { kind: RecordKind; id: string }[];
  removed: { kind: RecordKind; id: string }[];
  modified: { kind: RecordKind; id: string; fields: string[] }[];
  cascade: { kind: RecordKind; id: string; because: string }[]; // removed or changed as a consequence of a remove
  findingsIntroduced: Finding[];
  findingsResolved: Finding[];         // findings that go away while the record they sit on stays
  findingsGone?: Finding[];            // findings that go away only because the patch removed the record they sit on

  unitsAffected: string[];             // units whose elements or capabilities the patch touches, or whose elements sit on a relationship it adds or removes
  errors: string[];                    // ops that could not apply (unknown id, duplicate add)
}

export interface LayoutNode { id: string; x: number; y: number; w: number; h: number }
export interface LayoutEdge { id: string; from: string; to: string; points: [number, number][] }
export interface ViewLayout { view: string; width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[] }

/** The bundle's description of its instance. Named so additive fields can merge into it (0.4: namespaces, below). */
export interface BundleInstance { name: string; title: string; description?: string; packs: { name: string; title: string; description: string; rules: { id: string; title: string; why: string; severity: Severity; how?: string }[] }[]; ladder: string[] }

export interface Bundle {
  engine: { version: string; built: string; hash: string; modelHash?: string; rules?: string }; // modelHash: config, model and plan only, so a patch can say which model it was written against; rules: the rule set's version (a hash of every pack, rule and severity)
  instance: BundleInstance;
  model: Model; plan: Plan;
  findings: Finding[];
  analysis: PlanAnalysis;
  patches: (Patch & { impact: Impact })[];
  layouts: ViewLayout[];
}

// ---------- tracker (additive) ----------
// The model owns structure (units, phases, dependencies); the tracker owns live state (status, assignee, sprint).
// The engine never talks to a tracker: an agent or a person exports raw tracker JSON to files, and the engine
// reads those files. See src/tracker/adapter.ts.

export type TrackerStatus = UnitStatus; // todo | doing | done

export interface TrackerCount { name: string; count: number; project?: string }

export interface TrackerInventory {
  adapter: string;                       // "jira"
  flavor?: string;                       // e.g. "cloud", "data-center"
  source?: { dir: string; files: string[] }; // the raw export, relative to the instance directory
  issues: number;
  projects: { key: string; name: string; style?: string; issues: number }[];
  issueTypes: { id: string; name: string; level: number; subtask: boolean; project?: string; count: number }[];
  hierarchy: { level: number; types: string[]; count: number }[];
  fields: { id: string; name: string; role: string; type?: string; custom: boolean; count: number; values?: TrackerCount[] }[];
  linkTypes: { id?: string; name: string; inward: string; outward: string; count: number }[];
  statuses: { id?: string; name: string; category: TrackerStatus; categoryName: string; count: number }[];
  components: TrackerCount[];
  labels: TrackerCount[];
  fixVersions: (TrackerCount & { released?: boolean })[];
  containers: { key: string; type: string; level: number; summary: string; parent?: string; children: number }[]; // issues above the standard level (epics, initiatives)
  notes: string[];                       // what discovery noticed (an unused legacy field, a team-managed project)
}

export interface TrackerIssueLink { type: string; direction: "inward" | "outward"; phrase: string; key: string }

export interface TrackerIssue {
  key: string; project: string; type: string; level: number; summary: string;
  status: string; statusCategory: TrackerStatus; statusCategoryName?: string;
  assignee?: string; sprint?: string; parent?: string; team?: string; points?: number;
  components: string[]; labels: string[]; fixVersions: string[];
  links: TrackerIssueLink[];
  acceptance?: string; updated?: string;
  values?: Record<string, string>;       // other field values as text, by field id (custom fields, description), for the mapping to pick from
}

export interface TrackerLink { unit: string; issue: string; confirmed_by?: string; confirmed_at?: string; note?: string }

export interface TrackerMapping {
  adapter: string;
  project?: string;
  unit_label_prefix: string;             // a label like de-unit:U-05 is an exact match
  phase: { as: "epic" | "initiative" | "fix-version" | "label"; match: Record<string, string> }; // phase id -> issue key, version or label
  unit: { issue_type: string; project?: string };
  dependency?: { link_type: string; direction: "outward" | "inward" }; // the side of the dependent issue whose phrase reads "depends on"
  owner_team?: { as: "component" | "custom-field" | "project"; field?: string; match: Record<string, string> }; // team id -> tracker value
  done_condition?: { field: string };
  status: { by: "category" | "name"; map: Record<string, TrackerStatus> };
}

export interface TrackerUnitState {
  unit: string; issue: string; how: "confirmed" | "label";
  status: string; statusCategory: TrackerStatus; mapped: TrackerStatus;
  assignee?: string; sprint?: string; parent?: string; team?: string; summary: string;
}

export interface TrackerReconcile {
  adapter: string;
  counts: { linked: number; proposed: number; unitsWithoutIssue: number; issuesWithoutUnit: number; statusDisagreements: number; dependencyOneSided: number; phaseDisagreements: number };
  linked: { unit: string; issue: string; how: "confirmed" | "label"; confirmed_by?: string; confirmed_at?: string }[];
  proposed: { unit: string; issue: string; score: number; reasons: string[] }[];
  unitsWithoutIssue: string[];
  issuesWithoutUnit: { issue: string; summary: string; phase?: string; type: string }[];
  statusDisagreements: { unit: string; issue: string; unitStatus: TrackerStatus; trackerStatus: string; mapped: TrackerStatus }[];
  dependencyOneSided: { unit: string; dependsOn: string; issue: string; dependsOnIssue: string; side: "model" | "tracker" }[];
  phaseDisagreements: { unit: string; issue: string; unitPhase: string; issuePhase?: string }[];
  state: Record<string, TrackerUnitState>;
  problems: string[];                    // mapping or links problems that stopped part of the reconciliation
}

/** What the tracker rule pack and the bundle read; loaded from <instance>/tracker/ by src/tracker/load.ts. */
export interface TrackerInput {
  dir: string;
  inventory?: TrackerInventory;
  mapping?: TrackerMapping;
  links: TrackerLink[];
  issues?: TrackerIssue[];
  problems: { file: string; message: string }[];
}

export interface BundleTracker {
  adapter: string;
  inventory?: {
    flavor?: string; issues: number;
    projects: TrackerInventory["projects"]; hierarchy: TrackerInventory["hierarchy"];
    issueTypes: number; fields: { id: string; name: string; role: string; count: number }[];
    linkTypes: TrackerInventory["linkTypes"]; statuses: TrackerInventory["statuses"];
    components: number; labels: number; fixVersions: number; notes: string[];
  };
  mapping?: TrackerMapping;
  reconcile?: TrackerReconcile;
}

export interface Instance { tracker?: TrackerInput }
export interface RuleContext { tracker?: TrackerInput }
export interface Bundle { tracker?: BundleTracker }

// ---------- user interface additions (additive; every field is optional, and the site has a fallback for each) ----------
// Core computes the model facts; the site only draws them.

/** A view's group in the views rail and its one-line scope sentence (the C4 title-and-scope rule). */
export interface View { group?: string; description?: string }

/** Who or what wrote a patch, at whose request, when, and against which model. */
export interface PatchProvenance {
  author: string;                        // "agent", or a person's role ("the delivery lead"); never a person's name in this repository
  agent?: { tool: string; model?: string; name?: string }; // name: the named agent that wrote it (0.4: "org-scout")
  requested_by?: string;
  request?: string;                      // the instruction, short
  created?: string;                      // ISO date or date-time
  based_on?: string;                     // engine.modelHash (or a prefix of it) of the model the patch was written against
}
export interface PatchDecision { by: string; at: string; reason?: string }
export interface Patch { provenance?: PatchProvenance; decision?: PatchDecision }

/** A record as it stood before or after a patch: enough to name it without the compiled model (which may not hold it). */
export interface RecordSnapshot { kind: RecordKind; id: string; name: string; from?: string; to?: string; relKind?: string; label?: string }

/** One field a modify op (or a cascade) changed, before and after, as display text. */
export interface FieldChange { kind: RecordKind; id: string; field: string; before?: string; after?: string }

/** A small before-and-after drawing of the curated view a patch touches most. Positions are shared: the layout is of the union. */
export interface ImpactDrawing {
  view: string; title: string;
  layout: ViewLayout;                    // the union of the before and after states of the view
  before: { elements: string[]; relationships: string[] };
  after: { elements: string[]; relationships: string[] };
  added: string[]; removed: string[]; changed: string[]; // element ids
  others: string[];                      // other curated views the patch touches, most affected first
  change?: ChangeNeighbourhood;          // the changed parts and their direct neighbours, drawn once as a merged diff
  views?: ViewChange[];                  // every curated view whose drawing the patch changes, most changed first
}

/**
 * The changed parts (added, removed or changed elements; else the ends of the relationships the patch adds or
 * removes) with their direct neighbours, laid out once on the union of both states, so one drawing can show the
 * change with removed parts struck and added ones marked. Neighbours past the cap are counted per zone in `more`.
 */
export interface ChangeNeighbourhood {
  layout: ViewLayout;                    // three columns: senders, the changed parts, receivers
  narrow?: ViewLayout;                   // the same parts in one column, for a phone
  centre: string[];                      // the changed parts
  elements: string[];                    // centre and the neighbours drawn
  relationships: string[];               // relationships drawn: each touches a changed part
  removedRelationships: string[];        // of those, the ones only the before state has
  addedRelationships: string[];          // and the ones only the after state has
  more: { zone: string | null; count: number }[]; // neighbours left out, by zone
}

/** What one curated view gains and loses: its drawn parts and the relationships among them. */
export interface ViewChange {
  view: string; title: string;
  elementsRemoved: string[]; elementsAdded: string[];
  relationshipsRemoved: string[]; relationshipsAdded: string[];
}

/**
 * A patch's verdict as a reviewer reads it. "fail": it breaks an error check. "caution": it passes the checks but is not
 * clean, so never shown green: findings that leave only with a removed record, units its text names that are not done
 * (a precondition not met), records its title or why names that no operation changes. "pass": none of these.
 * `reject` and `revise` say what to do instead of accepting: the file and field to edit, or what to tell Claude.
 */
export interface PatchVerdict { level: "fail" | "caution" | "pass"; reasons: string[]; reject: string; revise: string }

export interface Impact {
  verdict?: PatchVerdict;
  records?: Record<string, RecordSnapshot>; // "kind:id" -> the record, from whichever side holds it (after first)
  fieldChanges?: FieldChange[];
  mentioned?: { kind: RecordKind; id: string }[]; // ids the why text names
  unbacked?: { kind: RecordKind; id: string }[];  // ids the why text names that no op, and no cascade, touches
  drawing?: ImpactDrawing;
}

/** Zone bands behind a layered drawing (a view holding two or more zones), and the per-layer node order. */
export interface ViewLayout {
  bands?: { zone: string | null; y: number; h: number }[];
  order?: string[][];                    // node ids per layer, top to bottom; seeds the next build so a drawing does not reshuffle
}

export interface PlanAnalysis {
  unblocksTransitive?: Record<string, number>; // open unit -> how many open units depend on it, directly or through others
}

/** One box per zone (or per system when the model has no zones) with aggregated relationships between them. */
export interface ModelSummary {
  by: "zone" | "system";
  groups: { id: string; name: string; elements: string[]; kinds: Record<string, number>; view?: string }[]; // id "" holds elements with none; view: the curated view holding most of them
  edges: { from: string; to: string; count: number; kinds: Record<string, number>; relationships: string[] }[];
  layout: ViewLayout;                    // nodes are group ids
}

export type TourTarget =
  | "overview" | "model" | "plan" | "checks" | "changes" // a page
  | { view: string } | { element: string } | { focus: string; depth?: number } | { unit: string }
  | { rule: string } | { finding: string } | { patch: string } | { gate: string } | { tracker: string }
  | "strategy" | "notes" | { claim: string } | { note: string }
  | "teams" | "present" | { present: number } // added with present mode and the Teams page
  | { zone: string }; // Tier 1: a zone's generated scene ("_none" for the parts with no zone)

export interface TourStep {
  target: TourTarget; title: string; say: string; highlight?: string[];
  missing?: string;                      // set by the build when the target (or a highlighted element) is gone, with why
}

export interface Tour { title: string; steps: TourStep[] }
export interface Instance { tour?: Tour; tourProblems?: string[] } // from <instance>/tour.yaml

export interface Bundle {
  viewGroups?: { name: string; views: string[] }[];
  summary?: ModelSummary;
  tour?: Tour;
}

export interface BundleTracker {
  latestUpdate?: string;                 // the newest issue `updated` in the export: how fresh the tracker state is
  issueInfo?: Record<string, { summary: string; status: string; type: string; parent?: string }>; // issues the reconciliation names, for the match rows
}

// ---------- premises: what the design rests on (additive) ----------
// A claim is a statement the design depends on. Parts, relationships, units, phases and other claims name the claims
// they rest on in `rests_on`; the engine computes what would be in question if a claim were false (src/core/premise.ts).

export type ClaimKind = "premise" | "claim" | "assumption";
/** How well the claim is backed: evidence (measured or published), inference (reasoned from evidence), judgment (a person's call), untested (nothing tests it yet). */
export type ClaimGrade = "evidence" | "inference" | "judgment" | "untested";

export interface Claim {
  id: string; statement: string; kind: ClaimKind; grade: ClaimGrade;
  source?: string;                       // where it comes from: a document, a study, a person's role
  fallback?: string;                     // what the design does if the claim turns out false
  rests_on?: string[];                   // other claims this one rests on
  attrs?: Attrs;
}

export interface Model { claims?: Claim[] }
export interface Element { rests_on?: string[] }
export interface Relationship { rests_on?: string[] }
export interface Unit { rests_on?: string[] }
export interface Phase { rests_on?: string[] }

/** "If this claim is false": everything that rests on it, directly or through other claims, and the plan slice. */
export interface PremiseImpact {
  claim: string;
  direct: { kind: RecordKind; id: string }[];                     // records whose rests_on names the claim
  dependents: import("./types/premise-links.ts").PremiseReach[];  // every record resting on it, with the claim chain that reaches it (via[0] is this claim)
  counts: { elements: number; relationships: number; units: number; phases: number; claims: number; total: number };
  units: { phase: string; units: string[] }[];                    // the plan slice: units resting on it directly, through a part they move, or through their gate; by phase order
  openUnits: number;                                               // of those, units not done
  atStake?: string[];                                              // milestones not yet reached whose work rests on it: the ones status counts (src/core/status.ts)
}

export interface Bundle { premises?: Record<string, PremiseImpact> }

/**
 * Additive: how exposed the plan is before a claim is tested (src/core/premise.ts `exposure`). The first test lands
 * in the earliest milestone holding a unit that tests the claim (`attrs.tested_by`); `before` counts the open units of
 * the plan slice in milestones before that one, the work built on the claim before any evidence. With no test, every
 * open unit of the slice is exposed and `firstTest` is absent.
 */
export interface PremiseExposure {
  tests: string[];                                       // units that test it and are in the plan
  outsidePlanOrder?: string[];                         // settling designs whose plan order cannot be compared with this claim's
  firstTest?: { phase: string; units: string[] };        // the earliest milestone holding a test, and its tests there
  before: number;                                        // open units of the slice in milestones before the first test (all open units when untested)
  beforeByPhase: { phase: string; open: number }[];      // the same, by milestone in plan order
}
export interface PremiseImpact { exposure?: PremiseExposure }

/** A claim that names a flow metric (attrs.measured_by), its value today, its source and whether it holds. */
export interface ClaimFlowCheck { metric: string; view?: string; value?: number; source?: "tracker" | "declared"; holds?: boolean; text: string }
export interface PremiseImpact { flow?: ClaimFlowCheck }

/** The milestones whose status reasons name this claim as untested ("turned amber by this"), apart from atStake (whose own work rests on it). */
export interface PremiseImpact { amberBy?: string[] }

// ---------- notes and questions pinned to records (additive) ----------
// <instance>/notes.yaml. People and agents both write it; the dev server writes it for the page (src/dev/notes-api.ts).

export type NoteTargetKind = "system" | "zone" | "seam" | "capability" | "manual-work" | "activity" | "slowdown" | "exception" | "team" | "design" | "portfolio" | "element" | "relationship" | "contract" | "unit" | "phase" | "claim" | "patch" | "finding";
export type NoteKind = "note" | "question";
export type NoteStatus = "open" | "answered" | "resolved";

export interface Note {
  id: string;
  target: { kind: NoteTargetKind; id: string };  // a finding is named pack/rule@at
  kind: NoteKind; text: string; status: NoteStatus;
  answer?: string;
  author: "person" | "agent";
  created: string; updated: string;              // ISO date-times
}

/** Who wrote the answer: a person, or an agent (Claude). The page shows an agent's answer as "Answered by Claude". */
export interface Note { answered_by?: "person" | "agent" }

/** Where an answer comes from: the commands, files and records it was read from, one string each ("bun plumb.ts premise instances/premerge CL-01"). */
export interface Note { sources?: string[] }

export interface NotesFile { notes: Note[]; version: string; problems: string[] } // version: a hash of the file bytes ("none" when there is no file)

export interface Instance { notes?: NotesFile }
export interface RuleContext { notes?: Note[]; patchIds?: string[] }
export interface RuleContext { patches?: Pick<Patch, "id" | "why">[] } // the patches' free text, for the contact-details check
export interface Bundle { notes?: { version: string; items: Note[] } }

// ---------- comparing builds (additive) ----------

/** One record in a comparison, named from whichever build holds it. */
export interface DiffRecord { kind: string; id: string; name: string }

/** What changed between two builds: computed by src/site/client/digest.js, shared by the page and `plumb diff`. */
export interface BuildDiff {
  from: { label: string; built?: string; hash?: string; rules?: string };
  to: { label: string; built?: string; hash?: string; rules?: string };
  findings: { added: DiffRecord[]; gone: DiffRecord[] };
  units: { ready: DiffRecord[]; done: DiffRecord[] };
  added: DiffRecord[]; removed: DiffRecord[]; changed: DiffRecord[];
  notes: { added: DiffRecord[]; answered: DiffRecord[]; resolved: DiffRecord[] };
  patches: { added: DiffRecord[]; decided: (DiffRecord & { from: string; to: string })[] };
  claims: { regraded: (DiffRecord & { from: string; to: string })[] };
  counts: Record<string, { added: number; removed: number; changed: number; reworded?: number }>; // per record kind; reworded: wording or owner only
  /** Status moves, milestone by milestone in plan order, and the plan's; only when both sides recorded status. */
  status?: { overall?: { from: string; to: string }; moves: (DiffRecord & { from: string; to: string; override?: boolean; computed?: string })[] }; // override: the new status is a person's call, computed beside it
  /** Changes in the checks rather than the design: rules added or removed, and the findings that came or went with them. */
  checks?: { rulesAdded: string[]; rulesRemoved: string[]; findingsAdded: DiffRecord[]; findingsGone: DiffRecord[] };
}

export interface Bundle { comparisons?: BuildDiff[] } // saved by `plumb diff --save` in <instance>/diffs/

// ---------- report snapshots (additive) ----------
// `bun plumb.ts report <instance> [--presented]` saves one in <instance>/reports/<timestamp>.json. The present deck's
// "what changed" compares the build with the last snapshot marked presented (what the room saw), else the last saved.

/** The digest the "since you last looked" panel uses (src/site/client/digest.js): one short hash per record, with state. */
export interface BuildDigest {
  v: number; built: string; hash: string; r: Record<string, string>;
  s?: { o: RagStatus; m: Record<string, RagStatus>; c?: Record<string, RagStatus> };  // the plan's status and each milestone's, as shown; c: each milestone's computed status
  rk?: string[];                                       // the rule set: every pack/rule key, so a new rule's findings read as a change in the checks
}

export interface ReportSnapshot {
  v: 1;
  saved: string;                         // ISO time the snapshot was written
  presented?: string;                    // ISO time it was marked as shown to the room
  built: string; hash: string; modelHash?: string;
  digest: BuildDigest;
  phases: { id: string; name: string; order: number; total: number; done: number; doing: number; ready: number }[];
  findings: { errors: number; warnings: number; byRule: Record<string, number> };
  tracker?: { latestUpdate?: string; linked: number; proposed: number; statusDisagreements: number; dependencyOneSided: number; phaseDisagreements: number; ownerDisagreements: number };
  premises?: { claims: number; untested: number; loadBearing: string[] };
  owners?: { parts: number; unownedParts: number; units: number; unassignedUnits: number };
  status?: { overall: RagStatus; milestones: { id: string; status: RagStatus; computed: RagStatus }[] }; // what the status was when it was saved
  engineVersion?: string;                // bundle.engine.version
  rules?: string;                        // bundle.engine.rules: the rule set's version
}

/** A saved snapshot as the bundle lists it (no digest). */
export interface ReportRef { file: string; saved: string; presented?: string; hash: string; built: string }

/** What changed since the deck's baseline: the last presented snapshot, else the last saved one. */
export interface SinceReport {
  basis: "presented" | "saved";
  against: ReportRef & { phases: ReportSnapshot["phases"]; findings: ReportSnapshot["findings"]; owners?: ReportSnapshot["owners"]; premises?: ReportSnapshot["premises"]; tracker?: ReportSnapshot["tracker"]; status?: ReportSnapshot["status"]; engineVersion?: string; rules?: string };
  diff: BuildDiff;
}

export interface Bundle { reports?: ReportRef[]; sinceReport?: SinceReport }

// ---------- teams and roles (additive) ----------
// The model's teams are the registry: an owner or verifier names a declared team. Parts carry `owner` and `verifier`;
// a unit inherits both from the parts it changes, and declares its own only where it differs (an override).
// Three part attrs the teams checks read, each naming declared teams: attrs.owner_teams (every team that owns the part,
// the accountable `owner` first), attrs.decider (the team or teams whose decision the part records; a team id or a
// list) and attrs.not (teams the part must stay independent of: neither its verifier nor an owner may be one).

export interface Element { verifier?: string }
export interface Unit { verifier?: string }

/** Where a unit's team for a role comes from: its parts, an override that differs from them, its own declaration (it changes no owned part), or nowhere. */
export type RoleSource = "parts" | "override" | "declared" | "none";

export interface UnitRoles { owners: string[]; ownerSource: RoleSource; verifiers: string[]; verifierSource: RoleSource }

export interface TeamFacts {
  units: Record<string, UnitRoles>;                        // every unit's owner and verifier teams
  unownedParts: string[];                                   // parts with no owner team
  unassigned: { phase: string; units: string[]; open: number }[]; // units with no owner team, by gate in plan order
  waitsOn: { from: string; to: string; count: number; pairs: [string, string][] }[]; // team `from` waits on team `to`: from's units depend on to's (unit, dependency)
  load: { team: string; open: number; share: number }[];   // open units each team owns, and its share of all open units
  maxShare: number;                                         // the team load threshold (engine.yaml teams.max_share)
  byGate: { team: string; gates: Record<string, { owner: number; verifier: number }> }[]; // role-by-gate counts
  separation: {
    // parts that fail: the verifier is the owner ("owner") or a co-owner in attrs.owner_teams ("co-owner"), or the
    // verifier ("excluded") or an owner team ("excluded-owner") is in attrs.not, the teams the part must stay independent of
    parts: { part: string; team: string; reason: "owner" | "co-owner" | "excluded" | "excluded-owner" }[];
    pairs: { unit: string; roles: [string, string]; team: string }[]; // role pairs (attrs.separates) that map to one team
    checkedParts: number;                                   // parts judged: they name an owner and a verifier
    passedParts: number; failedParts: number;               // judged parts that pass and fail (an owner in attrs.not is still listed in parts on an unjudged part)
    notAssessedParts: number;                               // parts that name no verifier: not assessed, never a pass
    checkedPairs: number; unmappedPairs: number; unassignedPairs: number; // how much could be checked at team level: pairs whose roles map, pairs naming a role with no engine counterpart, pairs whose roles have no team yet
  };
}

export interface Bundle { teams?: TeamFacts }

export interface TrackerReconcile {
  ownerDisagreements?: { unit: string; issue: string; owners: string[]; trackerTeam: string }[]; // the unit's owner teams against the team the tracker assigns
}

// ---------- present mode (additive) ----------
// <instance>/deck.yaml: one executive template, slides as queries over the bundle. Every number is computed; the
// decisions slide is hand-written and never generated (the engine lists candidates in its speaker notes only).

export type DeckTemplate = "title" | "thesis" | "status" | "changes" | "risks" | "decisions" | "milestones" | "challenges" | "path";

export interface DeckItem { text: string; sub?: string; tone?: "fail" | "warning" | "pass" | "info"; href?: string; grade?: string; id?: string; rag?: RagStatus; more?: boolean } // more: "this is not the whole list", on a cut-short path

/** A milestone as the leadership slides show it: its name, what it delivers, its status in words, a marker. */
export interface DeckMilestone {
  phase: string; name: string; delivers?: string; means?: string;
  status: RagStatus; reason: string;     // the one-line reason, in words
  marker?: "blocked" | "attention";      // red with blocked work, or anything else that needs attention
  override?: string;                     // "Set to amber by the delivery lead on 20 Oct 2026: …"
  computed?: RagStatus;                  // the computed status, when an override shows another one
  reached: boolean; current: boolean;
  flow?: string;                         // where flow explains the status: today's lead time and handoffs against the milestone's flow target, with their sources
}

export interface DeckSlide {
  template: DeckTemplate;
  title: string;
  lead?: string;                         // the computed sentence that opens the slide
  items?: DeckItem[];
  rows?: { cells: string[]; tone?: string }[]; // a table (status)
  head?: string[];
  asOf?: { built: string; tracker?: string }; // the status slide's one "as of" line: model build and the tracker export's newest change
  subtitle?: string;
  notes: string[];                       // speaker notes: computed, then the author's own from deck.yaml
  milestones?: DeckMilestone[];          // the road (status) and what each milestone means (milestones)
  groups?: { title: string; rag?: RagStatus; lead?: string; items: DeckItem[] }[]; // path to green: one group per milestone
}

export interface Deck { title: string; subtitle?: string; slides: DeckSlide[] }

export interface Bundle { deck?: Deck }


// ---------- zone scenes (additive, Tier 1) ----------
// One generated drawing per zone (src/core/zones.ts): the zone's parts and the relationships among them, laid out like
// any view, with a portal on the edge for each other zone that relationships leave to (right, "out") or come from
// (left, "in"), labelled with that zone and a count. Parts with no declared zone form one more scene (zone null).

export interface ZonePortal {
  zone: string | null; name: string; dir: "out" | "in";
  count: number;                         // relationships crossing to (or from) that zone
  relationships: string[]; parts: string[]; // the crossing relationships, and the zone's own parts they touch
  x: number; y: number; w: number; h: number;
  lines: { part: string; points: [number, number][] }[]; // one short line from each part to the portal (or back)
}

export interface ZoneScene { zone: string | null; name: string; layout: ViewLayout; portals: ZonePortal[]; relationships: number }

export interface Bundle { zoneScenes?: ZoneScene[] }


// ---------- milestones and status (additive) ----------
// A phase is shown as a milestone: a checkpoint where a complete unit of value is delivered. The data key stays
// `phase`. A milestone may say what it delivers and what reaching it lets the organization do or claim, carry a target
// date, and carry a person's status override. Units may carry a due date. Status (red, amber, green) is computed per
// milestone from criteria declared in engine.yaml (`status:`), each with its reasons in words and a path to green.

/** A person's call on a milestone's status, shown as an override beside the computed one. */
export interface StatusOverride { status: RagStatus; reason: string; date: string; by: string }

export interface Phase {
  delivers?: string;                     // the value the milestone delivers, one plain sentence
  means?: string;                        // what reaching it lets the organization do or claim
  target?: string;                       // ISO date the milestone is planned for
  override?: StatusOverride;
}
export interface Unit { due?: string }   // ISO date the work is due; past it and not done, it has slipped

export type RagStatus = "red" | "amber" | "green";

/** The criteria a status is computed from; engine.yaml `status: { red: [...], amber: [...] }` moves or drops them. */
export type StatusCriterion =
  | "no-provider"       // work on the path to the milestone needs a capability no work provides
  | "unowned-blocker"   // work on the path with no owner team holds up other work
  | "error-finding"     // an error finding sits on the milestone or the work on its path
  | "slipped"           // work on the path is past its due date and not done
  | "unowned"           // open work in the milestone has no owner team
  | "untested-premise"  // a load-bearing premise behind the milestone is untested
  | "tracker-disagrees" // the tracker disagrees with the plan about the milestone's work
  | "idle-ready";       // work in the milestone could start and nothing in it is in progress

export interface StatusRef { kind: RecordKind | "finding"; id: string }

export interface StatusReason { criterion: StatusCriterion; level: "red" | "amber"; text: string; refs: StatusRef[]; short?: string } // short: the one line the road, the deck, the Overview and the milestone card all say

/** One step on the path to green: the work by title, the team that owns it (null: needs an owner), what it unblocks. */
export interface PathAction {
  criterion: StatusCriterion; level: "red" | "amber";
  text: string;                          // the action as a sentence, titles first
  work?: StatusRef;                      // the unit, claim or finding the action is about
  teams: string[];                       // owner teams; empty when it needs an owner
  unblocks: string[];                    // unit ids it unblocks, nearest first
}

export interface MilestoneStatus {
  phase: string;
  status: RagStatus;                     // the override where there is one, else the computed status
  computed: RagStatus;
  reached: boolean; current: boolean;
  reasons: StatusReason[];
  override?: StatusOverride;
  path: PathAction[];                    // empty when the computed status is green
}

/** One thing most in the way, as an executive reads it: what, why it matters, who owns it. */
export interface Challenge { level: "red" | "amber"; criterion: StatusCriterion; text: string; teams: string[]; milestones: string[]; refs: StatusRef[] }

/** A load-bearing untested premise as a bet: "We are betting that …. If it is wrong, …. We are testing it by …". */
export interface RiskBet {
  claim: string; text: string;           // text: the three sentences together
  bet: string; ifWrong: string; testing: string; // "We are betting that …", "If it is wrong, …", "We are testing it by …" (or "Nothing tests it yet …")
  milestones: string[]; testedBy: string[]; teams: string[]; weight: number;
}

/** Computed against the build time (engine.built): a unit past its due date on that day has slipped. */
export interface PlanStatus {
  criteria: { red: StatusCriterion[]; amber: StatusCriterion[] };
  overall: { status: RagStatus; computed: RagStatus; text: string; lead?: { phase?: string; text: string } }; // lead: "Overall red. “X” is blocked: <its first reason>", the one sentence the Overview, the deck and the milestone share
  milestones: MilestoneStatus[];
  challenges: Challenge[];
  risks: RiskBet[];
}

export interface Bundle { status?: PlanStatus }
export interface Instance { milestoneProblems?: string[] } // from <instance>/milestones.yaml


// ---------- flow: waits, work, WIP and handoffs along a value stream (additive) ----------
// Declared on the model's parts (attrs): `wait_days` (person and process steps: days a change waits before the step
// starts), `work_days` (optional: days of work at the step), `wip_limit` (queues), each numeric and not negative, with
// their provenance `flow_source` (measured | estimated | declared) and `flow_as_of` (ISO date). Measured from the
// tracker where its export has status transitions (tracker/mapping.yaml `flow:`). src/core/flow.ts computes it all;
// the site only draws it, and every number on screen names its source and date.

/** Where a flow number comes from: measured (counted from real changes), estimated (a person's informed guess), declared (written down with no basis given). */
export type FlowSource = "measured" | "estimated" | "declared";

/** One declared flow number with its provenance. `source` absent: the model does not say (a flow finding says so). */
export interface FlowValue { value: number; source?: FlowSource; asOf?: string; ageDays?: number; stale?: boolean }

/** A value measured from tracker status transitions: the median days over `n` completed stays, the issues they came from, and how many are still in that status. */
export interface FlowMeasure { days: number; n: number; issues: string[]; open?: number; from?: string; to?: string }

/** A part's flow numbers: declared on the model, and measured from the tracker where a status maps to it. */
export interface FlowStep {
  element: string; team?: string;
  wait?: FlowValue; work?: FlowValue; wip?: FlowValue;
  measured?: { wait?: FlowMeasure; work?: FlowMeasure };
}

/** A handoff on a stream's path: the relationship, its two teams, and the step whose wait follows it (what removing the handoff could save at most). */
export interface FlowHop {
  relationship: string; from: string; to: string; fromTeam: string; toTeam: string;
  behind?: string; waitBehind?: FlowValue; measuredBehind?: FlowMeasure;
}

/** A sum of declared values along a path, split by source, with the steps that have none. */
export interface FlowSum { days: number; bySource: Partial<Record<FlowSource | "unknown", number>>; steps: string[]; missing: string[] }

/** One stream view: its path from start to end, what it adds up to, and the team handoffs along it. */
export interface StreamFlow {
  view: string; title: string;
  path: string[];                        // element ids, start to end, in stream order
  wait: FlowSum;                         // declared wait along the path
  work?: FlowSum;                        // declared work along the path, when any step declares it
  lead?: number;                         // wait plus work, when work is declared at every step with a wait
  efficiency?: number;                   // work over lead time, 0..1, under the same condition
  handoffs: number; limit: number;       // team handoffs on the path, and engine.yaml flow.max_handoffs
  hops: FlowHop[];                       // in path order
  oldest?: string;                       // the oldest as-of date among the values summed
  sources: FlowSource[];                 // the sources the sums draw on
  measured?: { lead: FlowMeasure; covered: string[]; declared: number }; // tracker lead time over the steps its statuses cover, beside the declared wait and work of those steps
}

/** What the tracker export says about flow: whether it has status history, and the medians per step and for lead time. */
export interface FlowMeasured {
  available: boolean;
  reason?: string;                       // why nothing is measured: no flow mapping, or no status history in the export
  issues: number; transitions: number;   // issues with history, and status changes read
  from?: string; to?: string;            // the dates the history spans
  statuses: { status: string; step: string; as: "wait" | "work" }[];
  done: string[];                        // statuses that end a change's lead time
  steps: Record<string, { wait?: FlowMeasure; work?: FlowMeasure }>;
  lead?: FlowMeasure;                    // from first entering a mapped status to entering a done status
  unknownSteps?: string[];               // mapped steps the model does not hold
}

export interface FlowFacts {
  limit: number; maxAgeDays: number; asOf: string;
  elements: Record<string, FlowStep>;
  streams: StreamFlow[];
  teamHandoffs: { from: string; to: string; count: number; relationships: string[] }[]; // every handoff relationship between two owner teams
  measured?: FlowMeasured;
}

export interface Bundle { flow?: FlowFacts }

/** A patch's lead-time effect on one stream: wait before and after by source, team handoffs before and after, the hops it adds and removes. */
export interface PatchFlowEffect {
  view: string; title: string;
  wait: { before: number; after: number; removed: Partial<Record<FlowSource | "unknown", number>>; added: Partial<Record<FlowSource | "unknown", number>> };
  lead?: { before: number; after: number };
  handoffs: { before: number; after: number; limit: number };
  hopsAdded: FlowHop[]; hopsRemoved: FlowHop[];
  stepsRemoved: string[];
  measured?: { element: string; wait?: FlowMeasure; work?: FlowMeasure }[]; // what the tracker measured at the steps the patch removes
  text: string;                          // the effect in one or two sentences, with the source words
}
export interface Impact { flow?: PatchFlowEffect[] }
/** The declared work before and after along the path, and the flow values the patch writes itself (its own estimate, no measurement behind it). */
export interface PatchFlowEffect { work?: { before: number; after: number }; own?: { element: string; key: "wait" | "work" | "wip"; before?: number; after?: number }[] }

export interface TrackerIssue {
  created?: string;
  transitions?: { at: string; from?: string; to: string }[]; // status changes, oldest first (Jira: the changelog)
}

/** tracker/mapping.yaml `flow:`: which tracker status means which stream step, waiting or worked on, and which statuses end a change's lead time. */
export interface TrackerMapping { flow?: { statuses: Record<string, { step: string; as: "wait" | "work" }>; done: string[] } }

/** A milestone's flow target (plan.yaml or milestones.yaml), read by the deck where flow explains its status. */
export interface Phase { flow_target?: { lead_days?: number; handoffs?: number } }

export interface RuleContext { today?: string }          // the build date (YYYY-MM-DD), for the age of flow values
export interface Instance { asOf?: string }               // set by the build before the checks run

/** A stream view's drawing (src/core/flow-layout.ts): the path in reading order, `perRow` steps to a row. */
export interface ViewLayout { stream?: { path: string[]; perRow: number } }

// ---------- status honesty (additive) ----------

/** A review-by date on a person's status call (YYYY-MM-DD): past it, the card, the road and the slide say the review is due. */
export interface StatusOverride { review_by?: string }

/** Who answers for a milestone (a role, never a person's name): shown on its card and named where a step needs an owner. */
export interface Phase { accountable?: string }
/** Who confirms the milestone's status, independently of who decides it (a role): with it, the card reads "Decides: <accountable> · Confirms: <confirmed_by>". */
export interface Phase { confirmed_by?: string }

/** Why a person's status call needs a second look: green while an earlier milestone it waits on is red, its computed status worse than when it was set, or its review date passed. */
export interface OverrideFlag { kind: "upstream-red" | "worsened" | "review-due"; text: string }
export interface MilestoneStatus { flags?: OverrideFlag[]; accountable?: string; confirmed_by?: string }

/** What a generated instance was imported with: engine.yaml `importer:`, written by the importer, left out of the model hash. */
export interface ImporterVersion { tool?: string; version?: string; titles?: string }
export interface Bundle { importer?: ImporterVersion }
export interface ReportSnapshot { importer?: ImporterVersion }
export interface SinceReport { importer?: { from?: ImporterVersion; to?: ImporterVersion } }

/** Records whose only change is their wording or owner (title, name, label, description, owner, verifier): re-derived, not redesigned. */
export interface BuildDiff { reworded?: DiffRecord[]; importer?: { from?: ImporterVersion; to?: ImporterVersion } }

/** Field-level changes by value (a unit's due date, milestone and owner, a part's owner, a milestone's target and hand-set status), and new risks (claims that became load-bearing and untested). */
export interface FieldMove extends DiffRecord { field: string; from: string; to: string }
export interface BuildDiff { fields?: FieldMove[]; risks?: DiffRecord[] }
/** A digest may carry each record's name (n) and the fields compared by value (f). */
export interface BuildDigest { n?: Record<string, string>; f?: Record<string, Record<string, string>> }
// BuildDigest.r values may carry "~" and a short hash of the record without its wording and owners, before any "|state".

/** A decision on the slide that names a patch carries that patch's computed verdict beside it. */
export interface DeckItem { verdict?: { level: "fail" | "caution" | "pass"; text: string } }
export interface DeckMilestone { flags?: string[]; accountable?: string }

/** The two sides of a change drawing: each drawn part's flow values and findings before and after the patch. */
export interface ChangeSide { flow?: Record<string, FlowStep>; findings: Record<string, { n: number; error: boolean }> }
export interface ChangeNeighbourhood { sides?: { before: ChangeSide; after: ChangeSide } }

/** Status over time: one column per distinct report snapshot (oldest first), then this build. */
export interface HistoryColumn {
  label: string; saved?: string; presented?: string; file?: string; now?: boolean;
  recorded: boolean;                     // the snapshot recorded status (older ones did not)
  overall?: RagStatus;
  milestones: Record<string, { status?: RagStatus; computed?: RagStatus; done: number; total: number }>;
  untested?: number;                     // load-bearing untested premises
}
export interface StatusHistory { phases: string[]; columns: HistoryColumn[] }
export interface Bundle { history?: StatusHistory }

/**
 * The glossary: a short definition for each word a reader meets on the page ("critical path", "unit", "zone").
 * Generic terms ship with the engine (src/core/glossary.ts); engine.yaml `glossary: { <term>: <definition> }` (or
 * `{ definition, forms }`) adds a term or overrides one by its name. `forms`: the words that match it on the page
 * (the term and its plural by default). The page shows the definition on hover or keyboard focus at a term's first
 * use in the tour's captions and in each page's section headings.
 */
export interface GlossaryTerm { term: string; definition: string; forms: string[]; source: "engine" | "instance" }
export interface Bundle { glossary?: GlossaryTerm[] }

// ---------- named leads (additive) ----------
// An optional `lead` at three levels, a free string: a person's name in a real deployment, a role title in the
// shipped and fictional instances ("the platform engineering lead"). Wording, not structure: left out of the model
// hash. A missing lead is never a finding; the page says "No lead named" where a lead would show.

/** Who runs the team. */
export interface Team { lead?: string }
/** Who owns delivering the milestone's outcome (milestones.yaml beside a generated plan). Apart from `accountable`, who decides its status. */
export interface Phase { lead?: string }
/** Who drives this piece of work, where it is not the owner team's lead (progress.yaml beside a generated plan). */
export interface Unit { lead?: string }

/**
 * A unit's lead as shown: `set` on the unit (its own `lead`), else inherited (`team`) from its owner team's lead (the
 * first of its owner teams, `of` counting them when there are several), else `none`.
 */
export interface UnitLead { lead?: string; source: "set" | "team" | "none"; team?: string; of?: number }
export interface Bundle { leads?: { units: Record<string, UnitLead> } }
/** A milestone's lead on the leadership slides: who owns delivering it, or absent when none is named. */
export interface DeckMilestone { leadName?: string }

// ---------- namespaces, the shared root, pins and editions (0.4, additive) ----------
// A design (an instance read as schema 0.4) has a namespace, imports one shared root and pins exact editions of other
// designs. Its references are rewritten to canonical form when it is
// compiled: its own records stay bare, everything else becomes "<ns>:<id>" (src/core/resolve.ts). Records brought in
// from elsewhere (a shared part, an org team, the far end of a crossing) carry `home`, the namespace they live in: they
// are outside records. A lone instance (no schema, namespace, root or pins) has none of this, and builds as 0.3.1 did.
// Feature-specific types live under src/types/ and are re-exported here.

export * from "./types/root.ts";
export * from "./types/shared.ts";
export * from "./types/portfolio.ts";
export * from "./types/current.ts";
export * from "./types/measure.ts";
import type { RootInput } from "./types/root.ts";
import type { Seam, SharedCapability } from "./types/shared.ts";
import type { PortfolioContext } from "./types/portfolio.ts";

/** The kinds a reference may name in the `<ns>:<kind>/<id>` form, where a field takes more than one kind. */
export type RefKind = "element" | "relationship" | "contract" | "team" | "unit" | "phase" | "claim" | "capability" | "activity" | "slowdown" | "exception" | "seam" | "manual-work" | "rule";

/** An exact pin: another design's edition by version and the sha256 of its edition.yaml (the full hash, or a prefix of 12 or more). */
export interface Pin { namespace: string; version: string; sha256: string; tag?: string }

export interface EditionFile { path: string; sha256: string }
/** edition.yaml: written by `plumb release` for a local design, shipped by released designs. */
export interface EditionStamp {
  line?: string; namespace?: string; version: string; released?: boolean; date?: string; build?: string;
  schema?: { model?: number | string; design_engine?: string };
  files: EditionFile[];                  // every frozen file but edition.yaml, with its hash
  digest?: string;                       // sha256 over the files list
  pins: Pin[];
  shared?: { path: string; sha256: string; namespace?: string; version?: string };   // the shared file the edition was checked with (a frozen copy sits beside it)
  manual_work?: { path: string; sha256: string } | null;  // the manual-work catalog, when it is its own file (null until it ships)
  [key: string]: unknown;
}
/** A released edition in <instance>/editions/<version>/. `sha256`: the hash of its edition.yaml bytes, which a pin names. */
export interface EditionRef { version: string; dir: string; sha256: string; stamp: EditionStamp }

/** Another design composed with this one (by a portfolio, or a test): what resolution and the pin checks read. */
export interface ComposedDesign {
  namespace: string; dir: string; title: string;
  edition?: string;                      // the released edition composed; absent: its working copy (latest)
  editionSha256?: string;
  model: Model; plan: Plan;              // its compiled records, its own ids bare
  pins: Pin[];
}

/** What a 0.4 design knows about its place in the import graph, read once by the loader (src/core/load.ts). */
export interface NamespaceInfo {
  schema: string;                        // the schema it is read as: "0.4"
  declared?: string;                     // the schema engine.yaml declares, when it does
  namespace?: string;
  root?: { path: string; dir: string; input?: RootInput }; // `root:` as written, resolved against the instance folder, and the root as loaded
  pins: Pin[];
  compose?: ComposedDesign[];            // other designs composed with this one
  configWritten: InstanceConfig;         // engine.yaml as written; the config the checks read has canonical references
  findings: Finding[];                   // problems with the schema, namespace, root and pins (core rules), found while loading
}
/** ns: set for a 0.4 design. edition: set when the build is of a released edition (its frozen design, with the live state now). loadWarnings: build warning lines found while loading (an older schema). */
export interface Instance { ns?: NamespaceInfo; edition?: EditionRef; loadWarnings?: string[] }

/** An outside record: the namespace it lives in ("shared", "org", or another design's). Absent on a design's own records. */
export interface Element { home?: string }
export interface Relationship { home?: string }
export interface Contract { home?: string }
export interface Team { home?: string }
export interface System { home?: string }
export interface Zone { home?: string }
export interface Claim { home?: string }

/** A 0.4 design's own module seams (model.yaml `seams:`). */
export interface Model { seams?: Seam[] }
/** The shared capabilities a design's units require and another design provides: outside records, ids "shared:<id>". */
export interface Plan { capabilities?: SharedCapability[] }
/** Capabilities required here and provided across a seam, each with the designs that provide it: never "no provider", and never available in a design's own build. */
export interface PlanAnalysis { outside?: Record<string, string[]> }

/** Set for a 0.4 design: its namespace, so a rule can tell a reference into another design from one it should resolve. `portfolio`: set only in a portfolio build. */
export interface RuleContext { ns?: { own?: string; rooted: boolean }; portfolio?: PortfolioContext }

/** A 0.4 design's place, for the page and the portfolio; absent on a lone instance. */
export interface BundleInstance {
  schema?: string; namespace?: string;
  root?: string;                         // `root:` as written
  pins?: Pin[];
  edition?: { version: string; date?: string; sha256: string }; // the released edition this build is of
  homes?: Record<string, string>;        // namespace -> how the page names it ("the shared layer", a design's title)
}

export * from "./types/premise-links.ts";
export interface Bundle { premiseLinks?: import("./types/premise-links.ts").PremiseLinks }
export interface PremiseImpact { preview?: { dependents: import("./types/premise-links.ts").PremiseReach[]; units: { phase: string; units: string[] }[]; openUnits: number } }

export interface PremiseExposure { settling?: { id: string; design: string; status?: string }[] }
export interface RuleContext { premiseLinks?: import("./types/premise-links.ts").PremiseLink[] }
