import type { PremiseImpact } from "../types.ts";

export type PremiseLinkStatus = "confirmed" | "declared" | "stale" | "found";
export interface PremiseLink {
  id: string;
  from: string;
  to: string;
  type: "depends-on" | "contradicts" | "duplicates";
  found?: { by: string; at: string; reasoning: string; sources: string[] };
  declaration?: { source: string };
  confirmed?: { by: string; at: string; falsifier_clause: string; moved_clause: string; pins: { from: string; to: string } };
  status: PremiseLinkStatus;
  hashes: { from: string; to: string };
  statements: { from: string; to: string };
  external?: boolean;
  changed: ("from" | "to")[];
}
export interface PremiseRun {
  id: string; by: string; at: string; designs: string[];
  pairs_considered: number; pairs_skipped: number; rule: string; proposed: string[];
}
export interface PremiseLinks {
  links: PremiseLink[];
  runs: PremiseRun[];
  debt: { declared: number; found: number; stale: number; flags: number; last_run: PremiseRun | null };
}
export interface PremiseStep { id: string; status: "confirmed" | "declared" | "found" }
export interface PremiseReach {
  kind: PremiseImpact["dependents"][number]["kind"]; id: string; via: string[];
  status?: "confirmed" | "declared" | "found"; links?: PremiseStep[];
}
