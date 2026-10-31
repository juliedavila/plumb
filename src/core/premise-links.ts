// Read-only reconciliation evidence. Only current, explicitly confirmed links affect normal impact.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Claim, Finding, Model, Plan, PremiseLink, PremiseLinks, PremiseRun } from "../types.ts";
import { sha256 } from "./util.ts";
import { allPremiseImpacts } from "./premise.ts";
import { count } from "../site/prose.ts";

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
export const falsifier = (c: Claim): string => String(c.attrs?.falsifier ?? "");
export const movedFields = (c: Claim): string[] => [c.attrs?.load, c.attrs?.if_it_flips, c.fallback].filter((x) => typeof x === "string") as string[];
export function premiseHash(c: Pick<Claim, "statement" | "attrs">): string {
  const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  return sha256(`${norm(c.statement)}\n${norm(c.attrs?.falsifier)}`).slice(0, 12);
}
const map = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const integer = (v: unknown) => Number.isInteger(v) && Number(v) >= 0;
export const emptyPremiseLinks = (): PremiseLinks => ({ links: [], runs: [], debt: { found: 0, stale: 0, flags: 0, last_run: null } });

/** Validate against the qualified composed model. Missing designs are outside this scope, never invented records. */
export function validatePremiseLinks(raw: unknown, model: Model, designs: string[]): { data: PremiseLinks; findings: Finding[] } {
  const data = emptyPremiseLinks(), findings: Finding[] = [];
  const issue = (at: string, message: string, severity: Finding["severity"] = "error") => findings.push({ pack: "premises", rule: "links-valid", severity, at, atKind: "instance", message: `premise-links.yaml: ${message}` });
  if (!map(raw)) { issue("premise-links.yaml", "must be a mapping with links and runs"); return { data, findings }; }
  for (const k of Object.keys(raw)) if (!["links", "runs"].includes(k)) issue("premise-links.yaml", `unknown top-level key ${k}`, "warning");
  const claims = new Map((model.claims ?? []).filter((c) => c.kind === "premise").map((c) => [c.id, c]));
  const scopes = new Set(["shared", ...designs]);
  const ids = new Set<string>(), duplicates = new Set<string>();
  if (raw.links !== undefined && !Array.isArray(raw.links)) issue("premise-links.yaml", "links must be a list");
  for (const x of Array.isArray(raw.links) ? raw.links : []) {
    const at = map(x) && text(x.id) ? x.id : "premise-links.yaml";
    const start = findings.length;
    if (!map(x)) { issue(at, "a link must be a mapping"); continue; }
    if ([x.from, x.to].every((ref) => text(ref) && /^[^:]+:[^:]+$/.test(ref) && !scopes.has(ref.split(":")[0]))) continue;
    if (!text(x.id) || !/^PL-\d+$/.test(x.id)) issue(at, "link id must be PL-<digits>");
    if (ids.has(x.id)) { issue(at, `duplicate link id ${x.id}`); duplicates.add(x.id); }
    ids.add(x.id);
    if (!["depends-on", "contradicts", "duplicates"].includes(x.type)) issue(at, `unknown link type ${String(x.type)}`);
    if (!map(x.found) || ![x.found.by, x.found.at, x.found.reasoning].every(text) || !texts(x.found.sources) || !x.found.sources.length) issue(at, "found needs by, at, reasoning and non-empty sources");
    const absent: string[] = [];
    for (const side of ["from", "to"] as const) {
      const ref = x[side];
      if (!text(ref) || !/^[^:]+:[^:]+$/.test(ref)) { issue(at, `${side} must name a qualified premise`); continue; }
      const ns = ref.split(":")[0];
      if (!scopes.has(ns)) absent.push(ref);
      else if (!claims.has(ref)) issue(at, `${ref} does not resolve to a premise present in scope`);
    }
    if (absent.length) issue(at, `${absent.join(" and ")} ${absent.length === 1 ? "names a design" : "name designs"} absent from scope, so ${at} is skipped`, "warning");
    if (x.from === x.to) issue(at, "from and to must be different premises");
    const from = claims.get(x.from), to = claims.get(x.to);
    const confirmationStart = findings.length;
    if (x.confirmed !== undefined) {
      const c = x.confirmed;
      if (!map(c) || ![c.by, c.at, c.falsifier_clause, c.moved_clause].every(text) || !map(c.pins) || ![c.pins.from, c.pins.to].every((p) => typeof p === "string" && /^[0-9a-f]{12}$/.test(p))) issue(at, "confirmed needs by, at, both clauses and both 12 hex pins");
      else {
        if (/^agent:/i.test(c.by)) issue(at, "confirmed.by must name a person or role, never an agent");
        if (to && !falsifier(to).includes(c.falsifier_clause)) issue(at, `falsifier_clause is not an exact substring of ${x.to}'s falsifier`);
        if (from && !movedFields(from).some((field) => field.includes(c.moved_clause))) issue(at, `moved_clause is not an exact substring of ${x.from}'s load or if_it_flips/fallback`);
      }
    }
    if (absent.length || findings.slice(start, confirmationStart).some((f) => f.severity === "error") || !from || !to) continue;
    const validConfirmation = x.confirmed !== undefined && !findings.slice(confirmationStart).some((f) => f.severity === "error");
    const hashes = { from: premiseHash(from), to: premiseHash(to) };
    const changed = map(x.confirmed) && map(x.confirmed.pins) ? (["from", "to"] as const).filter((s) => x.confirmed.pins[s] !== hashes[s]) : [];
    const status = validConfirmation ? changed.length ? "stale" : "confirmed" : "found";
    const link: PremiseLink = { id: x.id, from: x.from, to: x.to, type: x.type, found: x.found, ...(validConfirmation ? { confirmed: x.confirmed } : {}), hashes, statements: { from: from.statement, to: to.statement }, changed, status };
    data.links.push(link);
    if (link.type !== "depends-on") issue(at, `review flag: ${link.type} between ${link.from} and ${link.to}`, "warning");
  }
  data.links = data.links.filter((l) => !duplicates.has(l.id));
  const runIds = new Set<string>();
  if (raw.runs !== undefined && !Array.isArray(raw.runs)) issue("premise-links.yaml", "runs must be a list");
  for (const r of Array.isArray(raw.runs) ? raw.runs : []) {
    if (!map(r) || ![r.id, r.by, r.at, r.rule].every(text) || !texts(r.designs) || !r.designs.length || !texts(r.proposed) || !integer(r.pairs_considered) || !integer(r.pairs_skipped)) {
      issue("premise-links.yaml", "run records need id, by, at, designs, pairs_considered, pairs_skipped, rule and proposed with non-negative integer counts"); continue;
    }
    if (runIds.has(r.id)) { issue(r.id, `duplicate run id ${r.id}`); continue; }
    runIds.add(r.id);
    data.runs.push(r as PremiseRun);
    if (r.pairs_skipped > 0) issue(r.id, `${count(r.pairs_skipped, "skipped pair")}. Selection source: run ${r.id}, rule: ${r.rule}`, "warning");
  }
  // The graph direction is immaterial for detecting cycles. Keep the premise names in the warning.
  const edges = new Map<string, string[]>();
  for (const l of data.links.filter((l) => l.type === "depends-on")) edges.set(l.from, [...(edges.get(l.from) ?? []), l.to]);
  const done = new Set<string>(), stack: string[] = [];
  const visit = (id: string) => {
    if (stack.includes(id)) { issue(id, `depends-on cycle: ${[...stack.slice(stack.indexOf(id)), id].join(" -> ")}`, "warning"); return; }
    if (done.has(id)) return;
    stack.push(id);
    for (const to of edges.get(id) ?? []) visit(to);
    stack.pop(); done.add(id);
  };
  for (const id of edges.keys()) visit(id);
  data.debt = { found: data.links.filter((l) => l.type === "depends-on" && l.status === "found").length, stale: data.links.filter((l) => l.type === "depends-on" && l.status === "stale").length, flags: data.links.filter((l) => l.type !== "depends-on").length, last_run: data.runs.at(-1) ?? null };
  return { data, findings };
}

export function readPremiseLinks(dir: string | undefined, model: Model, designs: string[]) {
  if (!dir || !existsSync(join(dir, "premise-links.yaml"))) return { data: emptyPremiseLinks(), findings: [] as Finding[] };
  try { return validatePremiseLinks(Bun.YAML.parse(readFileSync(join(dir, "premise-links.yaml"), "utf8")), model, designs); }
  catch (e) { return { data: emptyPremiseLinks(), findings: [{ pack: "premises", rule: "links-valid", severity: "error", at: "premise-links.yaml", atKind: "instance", message: `premise-links.yaml could not load: ${(e as Error).message}` }] as Finding[] }; }
}

/** Shared register claims bypass the design resolver. Check their settling work in the same scope. */
export function sharedSettlingFindings(model: Model, plan: Plan, designs: string[], composed: boolean): Finding[] {
  const scopes = new Set(["shared", ...designs]), units = new Set(plan.units.map((u) => u.id));
  const out: Finding[] = [];
  for (const c of model.claims ?? []) if (c.id.startsWith("shared:")) for (const id of strings(c.attrs?.tested_by)) {
    const ns = id.split(":")[0];
    const absent = !scopes.has(ns);
    if ((absent && !composed) || units.has(id)) continue;
    out.push({ pack: "premises", rule: "links-valid", severity: absent ? "warning" : "error", at: c.id, atKind: "claim", message: absent ? `${c.id} names settling unit ${id} in an unknown namespace in this workspace` : `${c.id} names settling unit ${id}, which does not resolve in its present design` });
  }
  return out;
}

/** A stable read-only projection. All unit and premise ids arrive qualified from composition. */
export function premisesProjection(designs: string[], model: Model, plan: Plan, data: PremiseLinks) {
  const units = new Map(plan.units.map((u) => [u.id, u]));
  const impacts = allPremiseImpacts(model, plan, data.links);
  const premises = (model.claims ?? []).filter((c) => c.kind === "premise").map((c) => ({
    id: c.id, design: c.id.split(":")[0], statement: c.statement, grade: c.grade, falsifier: falsifier(c),
    load: c.attrs?.load ?? null, if_it_flips: c.attrs?.if_it_flips ?? c.fallback ?? null, fallback: c.fallback ?? null,
    rests_on: c.rests_on ?? [], settling_units: strings(c.attrs?.tested_by).map((id) => ({ id, ...(units.has(id) ? { status: units.get(id)!.status ?? "todo" } : {}) })),
    hash: premiseHash(c), links: data.links.filter((l) => l.from === c.id || l.to === c.id),
    preview: impacts[c.id]?.preview ?? { dependents: [], units: [], openUnits: 0 },
  })).sort((a, b) => a.design.localeCompare(b.design) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { designs, premises, links: data.links, runs: data.runs, debt: data.debt };
}
export function premisesText(p: ReturnType<typeof premisesProjection>): string {
  let design = "";
  return p.premises.map((c) => {
    const heading = c.design !== design ? `\n# ${c.design}\n` : ""; design = c.design;
    return `${heading}\n${c.id} (${c.grade})\n${c.statement}\nFalsifier: ${c.falsifier}\nLoad: ${c.load ?? ""}\nIf it flips: ${c.if_it_flips ?? ""}\nRests on: ${c.rests_on.join(", ") || "none"}\nSettling units: ${c.settling_units.map((u) => `${u.id} (${u.status ?? "not in this workspace"})`).join(", ") || "none"}\nHash: ${c.hash}\nLinks: ${c.links.map((l) => `${l.id} ${l.from} ${l.type} ${l.to} (${l.status})`).join(", ") || "none"}\n`;
  }).join("").trim() || "No premises in scope.";
}
