// The tracker adapter contract. One adapter per tracker (Jira today; other issue trackers, Azure Boards or Linear later).
//
// The principle: the model owns structure (units, phases, dependencies); the tracker owns live state
// (status, assignee, sprint). An adapter never touches the network. An agent in Claude Code, or a person,
// fetches from the tracker's API and writes the raw responses to a directory; the adapter reads that
// directory and the engine reads and writes only files under <instance>/tracker/.
//
// Everything the engine decides from tracker data (which issue is which unit, what disagrees) is done by
// the generic reconciler in reconcile.ts over the normalized TrackerIssue list an adapter returns, so a new
// adapter only has to read its own export format and write its own import format.

import { adapter as jira } from "./jira/index.ts";
import type { OrgDraftInput } from "./jira/draft-org.ts";
import type { Model, Plan, TrackerInventory, TrackerIssue, TrackerLink, TrackerMapping, TrackerReconcile } from "../types.ts";

export interface RawExport {
  dir: string;                    // absolute path of the raw export directory
  files: { name: string; json: unknown }[]; // every *.json in it, parsed, in name order
}

export interface ExportFile { name: string; content: string; notes: string[] }

export interface TrackerAdapter {
  name: string;
  title: string;
  /** Read raw tracker responses and describe what the organization actually uses, with usage counts. */
  discover(raw: RawExport): TrackerInventory;
  /** Propose a mapping from the inventory and the instance, as YAML text with a comment on each choice. A person edits it. */
  draftMapping(inv: TrackerInventory, model: Model, plan: Plan): string;
  /** The live state: every issue in the export, normalized. */
  readState(raw: RawExport, inv?: TrackerInventory): TrackerIssue[];
  /** Write the structure of the compiled plan's units that are not linked yet in the tracker's own bulk-import format. */
  exportStructure(plan: Plan, mapping: TrackerMapping, inv: TrackerInventory, rec: TrackerReconcile, model?: Model): ExportFile; // model: for the owner team units inherit from their parts
  /** Optional: a link to an issue, when the export says where the tracker lives. */
  issueUrl?(inv: TrackerInventory, key: string): string | undefined;
  /** Optional: when the export was taken, as an ISO date-time, when the export says (the window of a BAU measure ends there). */
  exportedAt?(raw: RawExport): string | undefined;
  /** Optional: an org mapping (kind: org) for a shared root, from the inventory and the org layer's teams and activities. */
  draftOrgMapping?(inv: TrackerInventory, org: OrgDraftInput): string;
}

export type { TrackerInventory, TrackerIssue, TrackerLink, TrackerMapping, TrackerReconcile };

const registry = new Map<string, TrackerAdapter>([[jira.name, jira]]);

export const ADAPTERS = [...registry.keys()];

export function getAdapter(name: string): TrackerAdapter {
  const a = registry.get(name);
  if (!a) throw new Error(`no tracker adapter "${name}"; known: ${ADAPTERS.join(", ")}`);
  return a;
}
