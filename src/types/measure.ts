// BAU measured from the tracker: the org mapping (tracker/mapping.yaml with
// `kind: org` in the shared root), where each issue lands (design work, an activity, or unclassified), each team's
// shares of its time in doing, coverage and confidence, the flow calibration of its WIP limit (Little's law), the
// measure snapshots in <root>/tracker/measures/, and what the root's bundle carries from them. src/types.ts
// re-exports these types.
import type { Confidence } from "./root.ts";

export type FlowItem = "feature" | "defect" | "risk" | "debt";

/**
 * What an issue must hold to match an activity rule. Every key given must hold; a key's list matches any one of its
 * values. `parent` matches an issue under that issue key, directly or through its parents; `field` maps a field id
 * (or its name) to the values that match.
 */
export interface ActivityMatch {
  project?: string[]; type?: string[]; labels?: string[]; components?: string[]; parent?: string[];
  field?: Record<string, string[]>;
}
/** One rule of an org mapping: an activity of the org layer and what its issues hold. */
export interface ActivityRule { activity: string; match: ActivityMatch }

/** The org part of tracker/mapping.yaml (`kind: org`): no phase or unit sections; the team comes from `team:`, read into owner_team. */
export interface OrgTrackerMapping {
  window_days: number;                   // the window ends at the export's date (default 90)
  designs: { label_prefix: string };     // <prefix><namespace>:<unit> marks design work (default "de-unit:")
  activities: ActivityRule[];            // first match wins, top to bottom, among the rules for the issue's own team's activities
  flow_items: Record<string, FlowItem>;  // issue type name -> flow item
}

declare module "../types.ts" {
  /** kind: org marks a shared root's org mapping; absent, or instance, is a design's own mapping as today. */
  interface TrackerMapping { kind?: "instance" | "org"; org?: OrgTrackerMapping }
  /**
   * namespace: the design's own, so its reconciliation reads de-unit:<namespace>:<unit> as its own unit's label.
   * exportedAt: the date-time the export holds for (Jira: serverInfo.serverTime), when the adapter can tell.
   */
  interface TrackerInput { namespace?: string; exportedAt?: string }
}

// ---------- a measure: one run of `bun plumb.ts tracker measure <root>` ----------

/** time: days in doing statuses from the status history; count: by count of open items, not time (no history exported). */
export type MeasureMode = "time" | "count";

/** Where one issue landed, and what it counts. */
export interface MeasuredIssue {
  key: string;
  team: string;                          // the org team, bare
  bucket: "design" | "activity" | "unclassified";
  of?: string;                           // the unit ("intake:U-04") or the activity id
  via?: "label" | "links";               // how design work was known
  days: number;                          // days in doing inside the window (time), or 1 when in doing now (count)
  finished?: boolean;                    // reached a done status inside the window and was done at its end
  cycle?: number;                        // a finished issue's days in doing statuses, its whole history
}

export interface ActivityMeasure {
  activity: string;                      // the org activity, bare
  name: string;
  issues: number; days: number;
  share: number;                         // of the team's days in doing (4 decimals)
}

/** Flow calibration of a team's WIP limit by Little's law: the measured numbers only. The limit is compared when read. */
export interface FlowCalibration {
  status: "calibrated" | "too-little" | "no-history";
  finished: number;                      // issues finished inside the window
  historyDays: number;                   // from the team's first status change in the export to the window's end
  needs: { finished: number; days: number };
  wip?: number;                          // L: days in doing inside the window / days in the window
  throughput?: number;                   // λ: items finished a day
  cycle?: number;                        // W: mean days in doing of the items finished
  littles?: number;                      // λ × W
  holds?: boolean;                       // L and λ × W agree within LITTLE_TOLERANCE of L
  wipStart?: number; wipEnd?: number;    // items in doing at the window's start and end
}

export interface TeamMeasure {
  team: string;                          // the org team, bare
  name: string;
  issues: number;                        // its issues counted
  inDoing: number;                       // in doing at the window's end
  days: number;                          // days in doing inside the window (time), or issues in doing now (count)
  design: { issues: number; days: number; share: number; by: Record<string, number> }; // by design namespace, days
  activities: ActivityMeasure[];         // its activities that have a rule, in org.yaml order
  unclassified: { issues: number; days: number; share: number };
  coverage?: number;                     // 1 - the unclassified share; absent when the team has no time in doing
  confidence: Confidence;
  flow: Partial<Record<FlowItem | "unmapped", number>>; // days in doing by the flow item of each issue's type
  calibration?: FlowCalibration;         // time mode only
  notes: string[];
}

export interface LeftOut {
  no_team: number;                       // no value in the team field
  other_team: number;                    // a team value the mapping does not name
  container: number;                     // an epic or above: a container, not a piece of work
  subtask: number;                       // a sub-task: its parent is the piece of work
  before_window: number;                 // finished before the window began
  after_window: number;                  // created after the window ended
}

/** tracker/measures/<as_of>.json: one measure run. Kept like report snapshots and never packaged. */
export interface MeasureSnapshot {
  v: 1;
  as_of: string;                         // the window's end date, YYYY-MM-DD: what every measured estimate is as of
  measured: string;                      // the run date, YYYY-MM-DD
  window: { from: string; to: string; days: number };
  export: { dir: string; files: string[]; at: string; at_from: "export" | "latest-update" | "as-of" };
  mapping: { sha256: string };
  mode: MeasureMode;
  doing: string[];                       // the statuses mapped to doing
  totals: { issues: number; counted: number; left_out: LeftOut };
  designs: { label_prefix: string; links: string[]; portfolio?: string }; // the designs whose tracker/links.yaml were read, from this portfolio
  notes: string[];
  teams: TeamMeasure[];
  issues: MeasuredIssue[];                 // one row per issue counted, written one to a line
}

// ---------- what the root's bundle carries from the snapshots ----------

/**
 * One measured value of an estimate: an activity's share, or a team's observed WIP (calibrated teams only), with what
 * the page's provenance line says of it: "0.38 of in-progress time · measured from the tracker, 90 days to 1 November,
 * 32 issues, high".
 */
export interface MeasuredPoint { as_of: string; value: number; confidence: Confidence; mode: MeasureMode; file: string; window_days: number; issues: number; coverage?: number }

/** Stated against measured, as the page says it: "Stated 10%, measured 22%: 12 points apart." */
export interface MeasureGap { stated: number; by?: string; measured: number; apart: number; over: boolean; text: string }

/** The calibration read against the limit in force: the suggestion beside the limit, in words. */
export interface CalibrationRead extends FlowCalibration {
  limit?: number;                        // the capacity in force
  verdict?: "over" | "under" | "holds" | "no-limit";
  proposed?: number;                     // round(L), at least 1: the value --limits would propose
  text: string;
}

/** The latest measure, per team, without the per-issue rows: what the load chart's unclassified band and the limit's suggestion read. */
export interface MeasureSummary {
  file: string; as_of: string; measured: string; mode: MeasureMode;
  window: MeasureSnapshot["window"]; totals: MeasureSnapshot["totals"];
  teams: (Omit<TeamMeasure, "calibration"> & { calibration?: CalibrationRead })[];
}

declare module "./root.ts" {
  interface EstimateFacts {
    /** From tracker/measures/: every measured value of this estimate (oldest first), the latest, and its gap from the stated figure. */
    measured?: { series: MeasuredPoint[]; latest?: MeasuredPoint; gap?: MeasureGap };
  }
  interface RootBundle {
    /** The root's tracker: the org mapping's measures. Absent when the root has no tracker/ folder. */
    tracker?: { adapter: string; measures: { file: string; as_of: string; mode: MeasureMode }[]; latest?: MeasureSummary };
  }
}
