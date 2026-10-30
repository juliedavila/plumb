// <instance>/tracker/links.yaml: confirmed matches between units and tracker issues.
// The file is a mapping from unit id to its issue, with who confirmed it and when as plain fields, so wiring a
// unit to an issue is a reviewed change to one file:
//
//   U-04:
//     issue: NOTE-13
//     confirmed_by: delivery lead
//     confirmed_at: 2026-10-20

import type { TrackerLink } from "../types.ts";
import { natCompare } from "../core/util.ts";

export interface LinksParse { links: TrackerLink[]; problems: string[] }

export function parseLinks(text: string): LinksParse {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = Bun.YAML.parse(text); } catch (e) { return { links: [], problems: [`links.yaml does not parse: ${(e as Error).message}`] }; }
  if (raw === null || raw === undefined) return { links: [], problems };
  if (typeof raw !== "object" || Array.isArray(raw)) return { links: [], problems: ["links.yaml must be a mapping from unit id to {issue, confirmed_by, confirmed_at}"] };
  const links: TrackerLink[] = [];
  for (const [unit, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") { links.push({ unit, issue: v }); continue; }
    if (!v || typeof v !== "object" || Array.isArray(v)) { problems.push(`links.yaml: ${unit} must map to an issue key or {issue, confirmed_by, confirmed_at}`); continue; }
    const o = v as Record<string, unknown>;
    if (o.issue === undefined || o.issue === null || String(o.issue).trim() === "") { problems.push(`links.yaml: ${unit} has no issue`); continue; }
    const l: TrackerLink = { unit, issue: String(o.issue).trim() };
    if (o.confirmed_by !== undefined && o.confirmed_by !== null) l.confirmed_by = String(o.confirmed_by);
    if (o.confirmed_at !== undefined && o.confirmed_at !== null) l.confirmed_at = o.confirmed_at instanceof Date ? o.confirmed_at.toISOString().slice(0, 10) : String(o.confirmed_at);
    if (o.note !== undefined && o.note !== null) l.note = String(o.note);
    links.push(l);
  }
  links.sort((a, b) => natCompare(a.unit, b.unit));
  return { links, problems };
}

const q = (s: string) => (/^[A-Za-z0-9][A-Za-z0-9 ._:/-]*$/.test(s) && !/^(true|false|null|yes|no|~)$/i.test(s) && !/:\s/.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s));

/** Deterministic links.yaml text: units in natural order, fields in a fixed order. parseLinks(formatLinks(x)) round-trips. */
export function formatLinks(links: TrackerLink[], header = true): string {
  const out: string[] = [];
  if (header) out.push(
    "# Confirmed matches between units and tracker issues: unit id -> issue, with who confirmed it and when.",
    "# Reconciliation proposes likely matches in reconcile.json; a person adds the ones they confirm here.",
    "",
  );
  for (const l of [...links].sort((a, b) => natCompare(a.unit, b.unit))) {
    out.push(`${q(l.unit)}:`, `  issue: ${q(l.issue)}`);
    if (l.confirmed_by !== undefined) out.push(`  confirmed_by: ${q(l.confirmed_by)}`);
    if (l.confirmed_at !== undefined) out.push(`  confirmed_at: ${JSON.stringify(l.confirmed_at)}`);
    if (l.note !== undefined) out.push(`  note: ${JSON.stringify(l.note)}`);
  }
  return out.join("\n") + "\n";
}
