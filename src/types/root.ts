// The shared root: one folder at the root of the import graph holding the shared layer
// (seams.yaml and manual-work.yaml, namespace `shared`) and the org layer (org.yaml, namespace `org`), with one team
// map, one patch log and one notes file for both. src/core/root.ts loads the root. These types cover the root's
// patches on both namespaces, the team map, estimates with provenance and history
// (src/core/estimate.ts), activities, slowdowns and exceptions (src/core/org.ts), the marks on what crosses
// (src/core/shared.ts) and the root's own build (src/core/root-build.ts).
import type { Attrs, BundleInstance, ComposedDesign, Finding, Note, NotesFile, Patch, PatchDecision, PatchProvenance, Team } from "../types.ts";
import type { SharedLayer } from "./shared.ts";

/** Where the shipped shared file came from: its hash at import and the editions that shipped it. */
export interface SharedFrom { sha256?: string; editions?: { namespace?: string; version?: string; sha256?: string }[] }

/** The root's engine.yaml: `kind: root`, and never a root or pins of its own. */
export interface RootConfig {
  kind: string; schema?: string; name?: string; title?: string;
  shared_from?: SharedFrom;
  [key: string]: unknown;
}

/** One org record with an id (an activity, a slowdown), as written; src/core/org.ts reads each into its own type. */
export interface OrgRecord { id: string; [key: string]: unknown }

/** org.yaml as resolution reads it, with the root's accepted patches applied: teams (names and leads), the other records as written. */
export interface OrgLayer {
  file: string; sha256: string;          // sha256: the file's bytes ("" when the org layer comes from patches alone)
  teams: Team[];                         // a team's other keys (row_owner, capacity) sit in its attrs, as written
  activities: OrgRecord[];
  slowdowns: OrgRecord[];
  seam_exceptions: Record<string, unknown[]>; // keyed by seam ("<seam id>", or "<ns>:<seam id>" for a module seam)
  extra: Record<string, unknown>;        // every other top-level key, untouched
  problems: string[];
}

// ---------- the root's patches ----------

/** The kinds a root patch changes. The kind says the namespace: team, activity, slowdown and exception are the org layer's; the rest the shared layer's. */
export type OrgKind = "team" | "activity" | "slowdown" | "exception";
export type SharedKind = "element" | "relationship" | "contract" | "capability" | "seam" | "system" | "zone" | "claim" | "manual-work";
export type RootKind = OrgKind | SharedKind;

/** One field a root patch set on one record, with the value it set: the history of an estimate reads these. */
export interface RootFieldSet { kind: RootKind; id: string; field: string; value: unknown; op: "add" | "modify" }

/** What one root patch changed, as an instance patch's ApplyResult says it, with the fields it set. */
export interface RootApplyResult {
  added: { kind: RootKind; id: string }[];
  removed: { kind: RootKind; id: string }[];
  modified: { kind: RootKind; id: string; fields: string[] }[];
  cascade: { kind: RootKind; id: string; because: string }[];
  errors: string[];                      // ops that could not apply
  sets: RootFieldSet[];
  namespaces: ("shared" | "org")[];      // the namespaces its ops change
}

/** How to load a root: with one more patch applied whatever its status, or without one even if accepted (a portfolio's impact). */
export interface RootLoadOptions { with?: string; without?: string }

// ---------- the team map ----------

/** One owner string or role, exactly as written, turned into teams: the first owns, the rest co-own (the shared owner-to-team mapping). */
export interface TeamMapEntry { teams: string[]; verifier?: string; decider?: string[]; not?: string[]; roles?: Record<string, string> }

/** <root>/team-map.yaml: one map from the owner strings and roles of every design and of the shared layer to teams. */
export interface RootTeamMap {
  file: string; sha256: string;
  owners: Record<string, TeamMapEntry>;
  unit_roles?: Record<string, string>;   // how unit role names map: owner, verifier, decider, or a team
  teams: Team[];                         // teams the map declares itself, for a root with no org layer
  problems: string[];
}

// ---------- estimates with provenance ----------

export type EstimateSource = "person" | "agent" | "tracker" | "derived";
export type Confidence = "low" | "medium" | "high";

/** A person's figure kept beside a measured value. */
export interface StatedFigure { value: number; by: string; as_of: string }

/** Every org number: its value with who or what gave it, when, and how sure. A lead and a note are wording. */
export interface Estimate {
  value: number; source: EstimateSource; by: string; as_of: string; confidence: Confidence;
  note?: string;
  stated?: StatedFigure;
}

/** A value an estimate held: from the record's own `history`, the value org.yaml writes, or an accepted root patch. */
export interface EstimatePoint {
  value: number; source?: string; by?: string; as_of?: string; confidence?: string; note?: string; stated?: StatedFigure;
  from: "history" | "file" | "patch";
  patch?: string;                        // the accepted patch that set it
  provenance?: PatchProvenance; decision?: PatchDecision;
}

/** One estimate as the page and the portfolio read it. `record` is canonical: "org:<id>". */
export interface EstimateFacts {
  record: string; kind: "team" | "activity" | "slowdown";
  field: string;                         // capacity, share, share_during, or relieved_by.<n>.to
  team?: string;                         // the team whose row it sits on, "org:<id>"
  value?: Estimate;                      // in force; absent when not stated or not valid
  problems: string[];                    // why it is not valid, in words
  ageDays?: number; stale: boolean;
  history: EstimatePoint[];              // oldest first; the last is the value in force
  pending: { patch: string; title: string; value: unknown; author?: string; agent?: string; created?: string }[]; // proposed root patches that would change it
  rowOwner?: { owner: string; statedByOwner: boolean }; // a person-sourced value on a team's row, and whether the row's owner stated it
}

// ---------- org records, read (src/core/org.ts) ----------

export interface OrgTeam { id: string; name: string; description?: string; lead?: string; row_owner?: string; capacity?: Estimate; attrs?: Attrs }

/** What brings an activity's share down: a unit done or a milestone reached, in any design; retire takes it to zero, reduce to `to`. */
export interface Relief { at: string; effect: "retire" | "reduce"; to?: Estimate }

/** Standing work that takes a share of a team's capacity: bau keeps the lights on, stream is another value stream the team serves. */
export interface Activity {
  id: string; team: string; name: string; type: "bau" | "stream"; flow_item?: string; description?: string;
  share?: Estimate;                      // absent when not stated or not valid
  manual_work?: string;                  // a kind of the shared manual-work catalog, canonical "shared:<id>"
  relieved_by: Relief[];
  attrs?: Attrs;
}

/** A deliberate slowdown: a written, expiring bet that frees capacity while a risk rises. Applied only when valid. */
export interface Slowdown {
  id: string; activity: string; what: string;
  share_during?: Estimate;
  from: string; until: string; max_until?: string;
  risk: { rises: string; refs: string[]; level?: string };
  accepted_by: string[]; accepted_at: string; review_by?: string;
  valid: boolean;
  attrs?: Attrs;
}

/** An exception to the seam rule: the shipped default, or the organization's own (which replaces the default for its seam). */
export interface SeamException {
  seam: string;                          // the key it is under: a shared seam's id, or "<ns>:<seam id>" for a module seam
  source: "default" | "org";
  index: number;                         // its place in its seam's list, from 1
  contracts: string[];                   // canonical: "shared:<name>", or "<ns>:<name>" for a design's own
  accepted_by?: string; until?: string; why?: string;
  valid: boolean;                        // an exception that is not valid does not apply
  problems: string[];
}

/** One problem the root's packs report, by rule (the packs turn each into a finding). */
export interface RootProblem { rule: string; at: string; atKind: Finding["atKind"]; message: string; severity?: Finding["severity"] }

/** The org layer read: typed records, the exceptions each seam takes, and their problems. */
export interface OrgView {
  teams: OrgTeam[]; activities: Activity[]; slowdowns: Slowdown[];
  exceptions: Record<string, SeamException[]>; // per seam key: the organization's list where it declares one, else the shipped default
  declined: string[];                    // seams whose shipped default the organization declined with an empty list
  estimates: EstimateFacts[];
  problems: RootProblem[];
}

// ---------- marks on what crosses (src/core/shared.ts) ----------

/**
 * A security mark. `floor`: the shipped rule codes the shipped file records ("shipped"), or, for a contract
 * or crossing the shipped file never held (the organization's own, a design's own edge), the engine's signals as a
 * provisional floor ("engine signal: <which>"). A person's raise adds; nothing lowers.
 */
export interface Mark { relevant: boolean; floor: string[]; floor_source: string; raised?: { by?: string; why?: string } }
export interface Marks { contracts: Record<string, Mark>; crossings: Record<string, Mark> }

// ---------- the root's own build ----------

/** What the org and shared packs read: set only in a root's own build (and by a portfolio build that checks its root). */
export interface RootCheck {
  input: RootInput;
  today?: string;                        // the build date, YYYY-MM-DD
  compose?: ComposedDesign[];            // designs composed with the root, for what reads into them
  org?: OrgView;
  marks: Marks;
  problems: RootProblem[];               // every problem src/core/org.ts and shared.ts found, by rule
}

declare module "../types.ts" {
  interface RuleContext { root?: RootCheck }
}

export interface RootInput {
  dir: string;                           // absolute
  config: RootConfig;
  shared?: SharedLayer;                  // the shared layer with the root's accepted patches applied
  shipped?: SharedLayer;                 // the shared layer exactly as the shipped seams.yaml holds it
  org?: OrgLayer;                        // the org layer with the root's accepted patches applied
  orgWritten?: OrgLayer;                 // the org layer exactly as org.yaml writes it: each estimate's history starts here
  teamMap?: RootTeamMap;
  patches?: Patch[];                     // every root patch, in natural id order, proposed and rejected ones too
  applied?: string[];                    // the patch ids applied, in order
  results?: Record<string, RootApplyResult>; // per applied patch, by its key (its file)
  notes?: NotesFile;                     // <root>/notes.yaml, targets canonical ("org:<id>", "shared:<id>")
  loadFindings?: Finding[];              // core findings: a patch file that does not parse, an op that does not apply
  problems: string[];                    // the folder is not a root, a file does not parse
  modelHash?: string;                    // what a root patch is written against: engine.yaml, the shipped shared layer, org.yaml and the team map, before patches, without leads and estimate notes
  hash?: string;                         // the model with every patch and the notes: everything the root's build rests on
}

/** The root's own build: what the page and the portfolio read. */
export interface RootBundle {
  premises?: Record<string, import("../types.ts").PremiseImpact>;
  premiseLinks?: import("./premise-links.ts").PremiseLinks;
  engine: { version: string; built: string; hash: string; modelHash: string; rules: string };
  root: {
    kind: "root"; name: string; title: string; description?: string; schema?: string; approver?: string;
    packs: BundleInstance["packs"];
    shared_from?: SharedFrom;
    estimates: { stale_after_days: number; gap: { share: number; capacity: number } };
  };
  shared?: SharedLayer;
  org?: OrgView;
  marks: Marks;
  teamMap?: { owners: Record<string, TeamMapEntry>; seams: Record<string, string[]>; parts: Record<string, string[]>; unmapped: string[] };
  patches: (Patch & { result?: RootApplyResult })[];
  findings: Finding[];
  notes?: { version: string; items: Note[] };
}
