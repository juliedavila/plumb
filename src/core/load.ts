import { parseYaml } from "./yaml.ts";
// Load an instance directory: engine.yaml, model.yaml, plan.yaml, patches/*.yaml.
// Normalizes records: ids become strings, single values become lists where a list is expected,
// and unknown keys move into `attrs` (which packs may read).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type {
  Claim, ComposedDesign, Contract, EditionRef, Element, Finding, Instance, InstanceConfig, Model, NamespaceInfo, Patch, PatchOp, Phase, Pin, Plan,
  RecordKind, Relationship, RootInput, StatusOverride, Team, TourTarget, Unit, View,
} from "../types.ts";
import { natCompare } from "./util.ts";
import { loadTracker } from "../tracker/load.ts";
import { loadTour } from "./tour.ts";
import { loadNotes } from "./notes.ts";
import { duplicateKeys } from "./yaml-keys.ts";
import { readSchema } from "./schema.ts";
import { namespaceProblem, parseRef, RESERVED } from "./namespace.ts";
import { loadRoot, normSeam } from "./root.ts";
import { loopText, noCycle, normPin, pinLoops, readEdition, readAdapterPaths, verifyEdition } from "./edition.ts";
import { canonicalConfig, canonicalNotes } from "./resolve.ts";
import { deprecatedKeyFindings } from "../migrate/keys.ts";
import { loadCurrent } from "./current.ts";

/** The design files a released edition freezes; every other file is live state, read from the instance folder. */
const DESIGN_YAML = ["engine.yaml", "model.yaml", "plan.yaml"];

/**
 * The instance's YAML files, relative to its directory, in a stable order: every file the engine reads as YAML.
 * Building a released edition (`design`: its folder, relative), the design files come from the edition and the rest
 * from the instance folder.
 */
export function instanceYamlFiles(dir: string, design?: string): string[] {
  const at = (f: string) => {
    if (design && ["model.yaml", "plan.yaml"].includes(f) && existsSync(join(dir, design, f.replace(".yaml", ".engine.yaml")))) return `${design}/${f.replace(".yaml", ".engine.yaml")}`;
    return design && (DESIGN_YAML.includes(f) || f.startsWith("patches/")) ? `${design}/${f}` : f;
  };
  const out = ["engine.yaml", "model.yaml", "plan.yaml", "milestones.yaml", "progress.yaml", "notes.yaml", "deck.yaml", "tour.yaml", "tracker/mapping.yaml", "tracker/links.yaml", "current.yaml"].map(at).filter((f) => existsSync(join(dir, f)));
  for (const pd of design ? [`${design}/patches`, "patches"] : ["patches"]) {
    const pdir = join(dir, pd);
    if (existsSync(pdir)) out.push(...readdirSync(pdir).filter((f) => /\.ya?ml$/.test(f)).sort(natCompare).map((f) => `${pd}/${f}`));
  }
  return out;
}

/** A key written twice in one mapping: the parser keeps the second and drops the first in silence, so the build fails instead. */
export function duplicateKeyFindings(dir: string, design?: string): Finding[] {
  const out: Finding[] = [];
  for (const rel of instanceYamlFiles(dir, design)) {
    let text: string;
    try { text = readFileSync(join(dir, rel), "utf8"); } catch { continue; }
    for (const d of duplicateKeys(text)) out.push({ pack: "core", rule: "yaml-keys-unique", severity: "error", at: rel, atKind: "instance",
      message: `${rel} line ${d.line}: the key "${d.key}" is written twice in one mapping (first on line ${d.first}); YAML keeps the second and drops the first without a word, so remove one` });
  }
  return out;
}

export const DEFAULT_LADDER = ["none", "stand-in", "existing-tool", "built"];
export const RECORD_KINDS: RecordKind[] = ["element", "relationship", "contract", "team", "system", "zone", "unit", "phase", "view", "claim"];
export const CLAIM_KINDS = ["premise", "claim", "assumption"] as const;
export const CLAIM_GRADES = ["evidence", "inference", "judgment", "untested"] as const;

type Raw = Record<string, unknown>;

function readYaml(path: string): unknown {
  const text = readFileSync(path, "utf8");
  try {
    return parseYaml(text,path);
  } catch (e) {
    throw new Error(`${path.split(/[\\/]/).pop()}: YAML parse error: ${(e as Error).message}`);
  }
}

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const strList = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null).map(String);
  return [String(v)];
};

/** Split a raw record into known keys and attrs (unknown keys merged over any explicit attrs). */
function split(raw: Raw, known: string[]): { k: Raw; attrs?: Record<string, unknown> } {
  const k: Raw = {};
  let attrs: Record<string, unknown> | undefined =
    raw.attrs && typeof raw.attrs === "object" && !Array.isArray(raw.attrs) ? { ...(raw.attrs as Raw) } : undefined;
  for (const [key, val] of Object.entries(raw)) {
    if (key === "attrs") continue;
    if (known.includes(key)) k[key] = val;
    else (attrs ??= {})[key] = val;
  }
  return { k, attrs };
}

function prune<T extends object>(o: T): T {
  for (const key of Object.keys(o)) if ((o as Raw)[key] === undefined) delete (o as Raw)[key];
  return o;
}

export function normElement(raw: Raw): Element {
  const { k, attrs } = split(raw, ["id", "name", "kind", "system", "zone", "owner", "verifier", "parent", "description", "rests_on"]);
  return prune({
    id: String(k.id), name: str(k.name) ?? String(k.id), kind: str(k.kind) ?? "element",
    system: str(k.system), zone: str(k.zone), owner: str(k.owner), verifier: str(k.verifier), parent: str(k.parent),
    description: str(k.description), rests_on: strList(k.rests_on), attrs,
  });
}

export function normRelationship(raw: Raw): Relationship {
  const { k, attrs } = split(raw, ["id", "from", "to", "kind", "label", "carries", "optional", "rests_on"]);
  return prune({
    id: String(k.id), from: String(k.from), to: String(k.to), kind: str(k.kind) ?? "data",
    label: str(k.label), carries: strList(k.carries),
    optional: k.optional === undefined ? undefined : Boolean(k.optional), rests_on: strList(k.rests_on), attrs,
  });
}

export function normContract(raw: Raw): Contract {
  const { k, attrs } = split(raw, ["name", "description", "produced_by", "consumed_by"]);
  const name = k.name ?? raw.id;
  return prune({
    name: String(name), description: str(k.description),
    produced_by: strList(k.produced_by), consumed_by: strList(k.consumed_by), attrs,
  });
}

export function normNamed(raw: Raw): Team {
  // a team's lead (who runs it) is a free string: a person's name in a real deployment, a role title here
  return prune({ ...(raw as object), id: String(raw.id), name: str(raw.name) ?? String(raw.id), description: str(raw.description), ...(raw.lead != null ? { lead: leadOf(raw.lead) } : {}) }) as Team;
}

/** A lead as written: one string, trimmed; an empty one is no lead. */
export function leadOf(v: unknown): string | undefined {
  const s = str(v)?.trim();
  return s ? s : undefined;
}

export function normView(raw: Raw): View {
  return prune({
    id: String(raw.id), title: str(raw.title) ?? String(raw.id),
    elements: strList(raw.elements) ?? [], relationships: strList(raw.relationships),
    group: str(raw.group), description: str(raw.description),
  });
}

export const RAG = ["red", "amber", "green"] as const;

/** What is wrong with a milestone status override, in words, or undefined when it is whole: a mapping with a status of red, amber or green, a reason, the date it was set (YYYY-MM-DD) and who set it. */
export function overrideProblem(v: unknown): string | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return `must be a mapping with status, reason, date and by, not ${JSON.stringify(v)}`;
  const r = v as Raw, out: string[] = [];
  const st = str(r.status)?.trim().toLowerCase();
  if (!st) out.push("has no status (red, amber or green)");
  else if (!(RAG as readonly string[]).includes(st)) out.push(`has status "${str(r.status)}", which is not red, amber or green`);
  if (!str(r.reason)?.trim()) out.push("gives no reason");
  out.push(...dateProblem(r.date));
  if (!str(r.by)?.trim()) out.push("does not say who set it (by)");
  if (r.review_by != null) { const rb = r.review_by instanceof Date ? r.review_by.toISOString().slice(0, 10) : str(r.review_by)?.trim(); if (!rb || !/^\d{4}-\d{2}-\d{2}/.test(rb)) out.push(`has review_by "${rb ?? ""}", which is not YYYY-MM-DD`); }
  return out.length ? out.join(", ") : undefined;
}

/** What is wrong with a date a person wrote when they set something: absent, or not YYYY-MM-DD. */
function dateProblem(v: unknown): string[] {
  const d = v instanceof Date ? v.toISOString().slice(0, 10) : str(v)?.trim();
  if (!d) return ["gives no date (date: YYYY-MM-DD)"];
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? [] : [`has date "${d}", which is not YYYY-MM-DD`];
}

/** A milestone status override, or undefined when it is not whole (overrideProblem says why; the loader reports it as an error). */
export function normOverride(v: unknown): StatusOverride | undefined {
  if (overrideProblem(v)) return undefined;
  const r = v as Raw;
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : str(v)!.trim());
  return { status: str(r.status)!.trim().toLowerCase() as StatusOverride["status"], reason: str(r.reason)!.trim(), date: day(r.date), by: str(r.by)!.trim(), ...(r.review_by != null ? { review_by: day(r.review_by) } : {}) };
}

/** An override that is not whole: a core error at the milestone, so the build fails loudly and the override is not applied. */
export function overrideFinding(phase: string, where: string, problem: string): Finding {
  return { pack: "core", rule: "override-valid", severity: "error", at: phase, atKind: "phase", message: `${where}: the status override on ${phase} ${problem}; it is not applied` };
}

export function normPhase(raw: Raw): Phase {
  return prune({
    id: String(raw.id), name: str(raw.name) ?? String(raw.id), exit_test: str(raw.exit_test) ?? "", order: Number(raw.order ?? 0), rests_on: strList(raw.rests_on),
    delivers: str(raw.delivers), means: str(raw.means), target: str(raw.target), override: normOverride(raw.override), accountable: str(raw.accountable), confirmed_by: str(raw.confirmed_by), lead: leadOf(raw.lead),
    flow_target: normFlowTarget(raw.flow_target),
  });
}

/** A milestone's flow target: { lead_days, handoffs }, each a number of at least zero; anything else is dropped. */
export function normFlowTarget(v: unknown): Phase["flow_target"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Raw, out: NonNullable<Phase["flow_target"]> = {};
  for (const k of ["lead_days", "handoffs"] as const) if (typeof r[k] === "number" && (r[k] as number) >= 0) out[k] = r[k] as number;
  return Object.keys(out).length ? out : undefined;
}

/**
 * <instance>/milestones.yaml (optional, written by hand): `milestones: { <phase id>: { delivers, means, target, override } }`.
 * Its fields go onto the plan's phases, over any the plan sets; an instance whose plan.yaml is generated (from an importer)
 * keeps its milestone words here. A phase id the plan does not hold is a problem, never an error.
 */
export function applyMilestones(dir: string, plan: Plan, findings?: Finding[]): string[] {
  const path = join(dir, "milestones.yaml");
  if (!existsSync(path)) return [];
  let raw: unknown;
  try { raw = parseYaml(readFileSync(path, "utf8"),path); } catch (e) { return [`milestones.yaml: YAML parse error: ${(e as Error).message}`]; }
  const m = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw).milestones : undefined;
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["milestones.yaml: expected a mapping under milestones: from phase ids to { delivers, means, target, override }"];
  const problems: string[] = [];
  for (const [id, v] of Object.entries(m as Raw)) {
    const ph = plan.phases.find((p) => p.id === id);
    if (!ph) { problems.push(`milestones.yaml: ${id} is not a phase in the plan`); continue; }
    if (!v || typeof v !== "object" || Array.isArray(v)) { problems.push(`milestones.yaml: ${id} must be a mapping`); continue; }
    const r = v as Raw;
    if (r.delivers != null) ph.delivers = String(r.delivers);
    if (r.means != null) ph.means = String(r.means);
    if (r.target != null) ph.target = String(r.target);
    if (r.accountable != null) ph.accountable = String(r.accountable);
    if (r.confirmed_by != null) ph.confirmed_by = String(r.confirmed_by);
    if (r.lead != null) { const l = leadOf(r.lead); if (l) ph.lead = l; else delete ph.lead; }
    if (r.flow_target != null) ph.flow_target = normFlowTarget(r.flow_target);
    if (r.override != null) {
      const bad = overrideProblem(r.override);
      if (!bad) ph.override = normOverride(r.override);
      else if (findings) findings.push(overrideFinding(id, "milestones.yaml", bad));
      else problems.push(`milestones.yaml: ${id}'s override ${bad}`);
    }
  }
  return problems;
}

/** The kinds of work a unit is, as the Flow Framework sorts it. */
export const FLOW_ITEMS = ["feature", "defect", "risk", "debt"] as const;

/**
 * <instance>/progress.yaml (optional, written by hand): `units: { <unit id>: { status, date, by, reason? } }`. A unit's
 * status set by a person over the plan's, with when and by whom, kept beside the plan so it survives a re-import of a
 * generated plan. The entry is copied to the unit's `attrs.status_set`. An entry with no status of todo,
 * doing or done, no date (YYYY-MM-DD) or no `by` is a `core/progress-valid` error at the unit and is not applied; a
 * unit id the plan does not hold is a problem (a build warning). An entry may also name the unit's `lead` (who drives
 * it, over its owner team's lead); an entry with only a lead sets the lead and nothing else, and needs no date or `by`.
 * In a 0.4 design (`flowItems`), an entry may also set the unit's `flow_item` over the plan's: the organization's own
 * reading of the work, which the page labels "set here". It is kept in `attrs.flow_item_set`, so
 * the plan's value stays readable beside it, and like a lead it needs no date or `by`. A value that is not feature,
 * defect, risk or debt is a `core/progress-valid` error and is not applied. A lone instance reads no flow item here.
 */
export function applyProgress(dir: string, plan: Plan, findings: Finding[], opts: { flowItems?: boolean } = {}): string[] {
  const path = join(dir, "progress.yaml");
  if (!existsSync(path)) return [];
  let raw: unknown;
  try { raw = parseYaml(readFileSync(path, "utf8"),path); } catch (e) { return [`progress.yaml: YAML parse error: ${(e as Error).message}`]; }
  const m = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw).units : undefined;
  if (m == null) return [];
  if (typeof m !== "object" || Array.isArray(m)) return ["progress.yaml: expected a mapping under units: from unit ids to { status, date, by, reason }"];
  const problems: string[] = [];
  for (const [id, v] of Object.entries(m as Raw)) {
    const u = plan.units.find((x) => x.id === id);
    if (!u) { problems.push(`progress.yaml: ${id} is not a unit in the plan`); continue; }
    const r = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Raw;
    if (r.lead != null) { const l = leadOf(r.lead); if (l) u.lead = l; else delete u.lead; }
    const flow = opts.flowItems && r.flow_item != null;
    if (flow) {
      const fi = str(r.flow_item)!.trim().toLowerCase();
      if ((FLOW_ITEMS as readonly string[]).includes(fi)) u.attrs = { ...(u.attrs ?? {}), flow_item_set: fi };
      else findings.push({ pack: "core", rule: "progress-valid", severity: "error", at: id, atKind: "unit", message: `progress.yaml: the flow item of ${id} is "${str(r.flow_item)}", which is not feature, defect, risk or debt; it is not applied` });
    }
    if ((r.lead != null || flow) && r.status == null && r.date == null && r.by == null && r.reason == null) continue; // a lead or a flow item alone
    const out: string[] = [];
    const st = str(r.status)?.trim().toLowerCase();
    if (!st || !["todo", "doing", "done"].includes(st)) out.push(st ? `has status "${str(r.status)}", which is not todo, doing or done` : "has no status (todo, doing or done)");
    out.push(...dateProblem(r.date));
    if (!str(r.by)?.trim()) out.push("does not say who set it (by)");
    if (out.length) { findings.push({ pack: "core", rule: "progress-valid", severity: "error", at: id, atKind: "unit", message: `progress.yaml: the status of ${id} ${out.join(", ")}; it is not applied` }); continue; }
    u.status = st as Unit["status"];
    const date = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : str(r.date)!.trim();
    u.attrs = { ...(u.attrs ?? {}), status_set: { status: st, date, by: str(r.by)!.trim(), ...(str(r.reason)?.trim() ? { reason: str(r.reason)!.trim() } : {}) } };
  }
  return problems;
}

export function normUnit(raw: Raw): Unit {
  const { k, attrs } = split(raw, ["id", "title", "kind", "phase", "elements", "requires", "provides", "check", "owner", "verifier", "feedback", "status", "rests_on", "due", "lead"]);
  const moves = Array.isArray(k.elements)
    ? (k.elements as Raw[]).map((m) => ({ id: String(m?.id), from: String(m?.from), to: String(m?.to) }))
    : undefined;
  const status = str(k.status);
  return prune({
    id: String(k.id), title: str(k.title) ?? String(k.id), kind: str(k.kind) ?? "code", phase: String(k.phase),
    elements: moves, requires: strList(k.requires), provides: strList(k.provides),
    check: str(k.check) ?? "", owner: str(k.owner), verifier: str(k.verifier), feedback: str(k.feedback),
    status: status as Unit["status"], rests_on: strList(k.rests_on), due: str(k.due), lead: leadOf(k.lead), attrs,
  });
}

/**
 * A claim: id, statement, kind (premise | claim | assumption; default premise), grade (evidence | inference |
 * judgment | untested; default untested), source, fallback, rests_on. An unknown kind or grade is kept as written so
 * the premises pack can report it.
 */
export function normClaim(raw: Raw): Claim {
  const { k, attrs } = split(raw, ["id", "statement", "kind", "grade", "source", "fallback", "rests_on"]);
  return prune({
    id: String(k.id), statement: str(k.statement) ?? "", kind: (str(k.kind)?.trim().toLowerCase() ?? "premise") as Claim["kind"],
    grade: (str(k.grade)?.trim().toLowerCase() ?? "untested") as Claim["grade"],
    source: str(k.source), fallback: str(k.fallback), rests_on: strList(k.rests_on && typeof k.rests_on === "object" && !Array.isArray(k.rests_on) && "claims" in k.rests_on ? (k.rests_on as Raw).claims : k.rests_on), attrs,
  });
}

export function normalize(kind: RecordKind, raw: Raw): any {
  switch (kind) {
    case "claim": return normClaim(raw);
    case "element": return normElement(raw);
    case "relationship": return normRelationship(raw);
    case "contract": return normContract(raw);
    case "team": case "system": case "zone": return normNamed(raw);
    case "view": return normView(raw);
    case "phase": return normPhase(raw);
    case "unit": return normUnit(raw);
  }
}

const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]).filter((x) => x && typeof x === "object") : []);

export function normModel(raw: Raw | undefined): Model {
  const r = raw ?? {};
  return {
    teams: list(r.teams).map(normNamed),
    systems: list(r.systems).map(normNamed),
    zones: list(r.zones).map(normNamed),
    elements: list(r.elements).map(normElement),
    relationships: list(r.relationships).map(normRelationship),
    contracts: list(r.contracts).map(normContract),
    views: list(r.views).map(normView),
    ...(Array.isArray(r.claims) ? { claims: list(r.claims).map(normClaim) } : {}),
  };
}

export function normPlan(raw: Raw | undefined): Plan {
  const r = raw ?? {};
  return { phases: list(r.phases).map(normPhase), units: list(r.units).map(normUnit) };
}

export const PATCH_STATUSES: Patch["status"][] = ["proposed", "accepted", "rejected"];

/** A problem found while reading a patch file: a core/patch-loads error finding at the file (or the patch id). */
export function patchProblem(at: string, message: string): Finding {
  return { pack: "core", rule: "patch-loads", severity: "error", at, atKind: "instance", message };
}

/**
 * Normalize a raw patch. Status is case-insensitive; an unknown status or an `ops` that is not a list
 * is reported in `problems` (when given), and the patch is then treated as proposed with no ops,
 * so nothing from it is applied by accident.
 */
export function normPatch(raw: Raw, file?: string, problems?: Finding[]): Patch {
  const stem = file ? basename(file).replace(/\.ya?ml$/, "") : "patch";
  const where = file ?? String(raw.id ?? stem);
  const rawStatus = raw.status === undefined || raw.status === null ? "proposed" : String(raw.status).trim().toLowerCase();
  let status = rawStatus as Patch["status"];
  if (!PATCH_STATUSES.includes(status)) {
    problems?.push(patchProblem(where, `${where}: status "${String(raw.status)}" is not one of ${PATCH_STATUSES.join(", ")}; the patch is treated as proposed and not applied`));
    status = "proposed";
  }
  let ops: PatchOp[] = [];
  if (Array.isArray(raw.ops)) {
    ops = (raw.ops as unknown[]).map((o) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) return o as unknown as PatchOp; // applyPatch reports it
      const op: Raw = { ...(o as Raw) };
      if (op.id !== undefined) op.id = String(op.id);
      return op as unknown as PatchOp;
    });
  } else if (raw.ops !== undefined && raw.ops !== null) {
    problems?.push(patchProblem(where, `${where}: ops must be a list of operations, not a ${typeof raw.ops === "object" ? "mapping" : typeof raw.ops}; none of its ops are applied`));
  }
  return prune({
    id: String(raw.id ?? stem), title: str(raw.title) ?? String(raw.id ?? stem),
    status, why: str(raw.why) ?? "", ops, file,
    provenance: normProvenance(raw.provenance), decision: normDecision(raw.decision),
  });
}

/** Optional patch provenance: a mapping with at least an author. Anything else is dropped (the site then says "Author not recorded"). */
export function normProvenance(v: unknown): Patch["provenance"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Raw;
  const author = str(r.author);
  if (!author) return undefined;
  const a = r.agent && typeof r.agent === "object" && !Array.isArray(r.agent) ? (r.agent as Raw) : undefined;
  const agent = a && str(a.tool) ? prune({ tool: str(a.tool)!, model: str(a.model), name: str(a.name) }) : undefined; // name: the named agent (0.4)
  return prune({ author, agent, requested_by: str(r.requested_by), request: str(r.request), created: str(r.created), based_on: str(r.based_on) });
}

export function normDecision(v: unknown): Patch["decision"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Raw;
  if (!str(r.by) || !str(r.at)) return undefined;
  return prune({ by: str(r.by)!, at: str(r.at)!, reason: str(r.reason) });
}

/**
 * The packs that check an instance: the ones engine.yaml lists, plus premises whenever the model declares claims,
 * notes whenever there is a notes file and teams whenever the model declares teams (or, for a 0.4 design, its root's
 * org layer does). (Added here, not to the config, so the model hash does not move with them.)
 */
export function packNames(inst: Pick<Instance, "config" | "model" | "notes"> & Partial<Pick<Instance, "tracker" | "ns">>): string[] {
  const out = [...inst.config.packs];
  if (inst.tracker && !out.includes("tracker")) out.push("tracker"); // a tracker folder brings its checks, as a notes file and teams do
  if (inst.model.claims?.length && !out.includes("premises")) out.push("premises");
  if (inst.notes && !out.includes("notes")) out.push("notes");
  if ((inst.model.teams.length || inst.ns?.root?.input?.org?.teams.length) && !out.includes("teams")) out.push("teams");
  // a 0.4 design with a root or module seams: the seam rule judges its own crossings
  if (inst.ns && (inst.ns.root || inst.model.seams?.length) && !out.includes("portfolio")) out.push("portfolio");
  return out;
}

/** The key that tells patches apart even when two share an id: the file, else the id. */
export const patchKey = (p: Pick<Patch, "id" | "file">): string => p.file ?? p.id;

export interface LoadOptions {
  edition?: string;                      // build this released edition (its frozen design, with the live state now)
  compose?: ComposedDesign[];            // other designs composed with this one (a portfolio, or a test)
  root?: RootInput;                      // the shared root as already loaded (a portfolio's, perhaps with or without one root patch); used when it is this design's root
}

const xrefAt = (message: string): Finding => ({ pack: "core", rule: "xref-resolves", severity: "error", at: "engine.yaml", atKind: "instance", message });

/**
 * A 0.4 design's namespace, root and pins, as engine.yaml writes them, with what is wrong with them as core findings:
 * xref-no-cycle for the import graph's shape (a namespace that is not one, more than one root, a root that imports,
 * a pin that is not exact or pins its own or a reserved namespace, a loop through composed designs, two composed
 * designs on one namespace), xref-resolves for a root that is not there.
 */
function readNamespace(cfgRaw: Raw, dir: string, config: InstanceConfig, schema: { declared?: string; findings: Finding[] }, opts: LoadOptions): NamespaceInfo {
  const findings: Finding[] = [...schema.findings];
  const nc = (m: string) => findings.push(noCycle("engine.yaml", m));
  let namespace: string | undefined;
  if (cfgRaw.namespace != null) { const p = namespaceProblem(cfgRaw.namespace); if (p) nc(`the namespace ${p}`); else namespace = String(cfgRaw.namespace); }
  let root: NamespaceInfo["root"];
  if (cfgRaw.root != null) {
    if (Array.isArray(cfgRaw.root)) nc(`root names ${cfgRaw.root.length} roots (${cfgRaw.root.map(String).join(", ")}); a design imports exactly one shared root`);
    else if (typeof cfgRaw.root !== "string" || !cfgRaw.root.trim()) nc(`root must be the path of the shared root's folder, not ${JSON.stringify(cfgRaw.root)}`);
    else {
      const rdir = resolve(dir, cfgRaw.root);
      const input = opts.root && resolve(opts.root.dir) === rdir ? opts.root : loadRoot(rdir);
      root = { path: cfgRaw.root, dir: rdir, input };
      for (const p of input.problems) findings.push(xrefAt(`root ${cfgRaw.root} does not resolve: ${p}`));
      for (const p of [...(input.shared?.problems ?? []), ...(input.org?.problems ?? [])]) findings.push(xrefAt(`root ${cfgRaw.root}: ${p}`));
      const own = ["root", "pins"].filter((k) => input.config[k] != null);
      if (own.length) nc(`the root ${cfgRaw.root} declares ${own.join(" and ")} of its own; the root sits at the top of the import graph and imports nothing`);
    }
  }
  const pins: Pin[] = [];
  if (cfgRaw.pins != null) {
    if (!Array.isArray(cfgRaw.pins)) nc("pins must be a list of { namespace, version, sha256 }");
    else for (const raw of cfgRaw.pins) {
      const { pin, problem } = normPin(raw);
      if (problem || !pin) { nc(problem ?? "a pin is not exact"); continue; }
      if (pin.namespace === namespace) { nc(`this design pins its own namespace (${namespace}): ${loopText([pin.namespace])}`); continue; }
      if ((RESERVED as readonly string[]).includes(pin.namespace)) { nc(`this design pins ${pin.namespace}, the shared root's namespace; a design imports the root and pins only designs`); continue; }
      if (pins.some((p) => p.namespace === pin.namespace)) { nc(`this design pins ${pin.namespace} twice; a pin is exact, so it names one edition`); continue; }
      pins.push(pin);
    }
  }
  const compose = opts.compose;
  if (compose?.length) {
    const seen = new Map<string, string>();
    if (namespace) seen.set(namespace, dir);
    for (const d of compose) {
      if ((RESERVED as readonly string[]).includes(d.namespace)) nc(`the composed design at ${d.dir} uses the namespace ${d.namespace}, which is reserved for the shared root`);
      else if (seen.has(d.namespace)) nc(`two designs share the namespace ${d.namespace} (${relative(process.cwd(), seen.get(d.namespace)!) || "."} and ${relative(process.cwd(), d.dir) || "."}); every reference between them would be ambiguous`);
      else seen.set(d.namespace, d.dir);
    }
    if (namespace) for (const cyc of pinLoops([{ namespace, pins }, ...compose.filter((d) => d.namespace !== namespace)])) if (cyc.length > 1 && cyc.includes(namespace))
      nc(`the pins form a loop: ${loopText(cyc)}; an exact pin loop has no solution, so the design that ships first pins nothing that leads back`);
  }
  return { schema: "0.4", ...(schema.declared ? { declared: schema.declared } : {}), ...(namespace ? { namespace } : {}), ...(root ? { root } : {}), pins, ...(compose ? { compose } : {}), configWritten: config, findings };
}

/** A tour target in the 0.4 key: `gate` (read in silence since 0.2) becomes `milestone`. */
function renameGate(t: TourTarget): TourTarget {
  return typeof t === "object" && t && "gate" in t ? { milestone: (t as { gate: string }).gate } as unknown as TourTarget : t;
}

export function loadInstance(dirIn: string, opts: LoadOptions = {}): Instance {
  const dir = resolve(dirIn);
  // A released edition: its frozen design (engine, model, plan, accepted patches), with the live state from the folder.
  const edition: EditionRef | undefined = opts.edition !== undefined ? readEdition(dir, opts.edition) : undefined;
  if (edition && (existsSync(join(edition.dir, "engine-import.yaml")) || existsSync(join(edition.dir, "model.engine.yaml")))) {
    const problems = verifyEdition(edition);
    if (problems.length) throw new Error(`imported edition ${edition.version} is not intact: ${problems.join("; ")}`);
  }
  const src = edition ? edition.dir : dir;
  const adapters = edition ? readAdapterPaths(edition) : undefined;
  const design = edition ? relative(dir, edition.dir) : undefined; // the edition folder, relative, for file names
  const enginePath = join(src, adapters?.engine ?? "engine.yaml");
  if (!existsSync(enginePath)) throw new Error(`${src}: no engine.yaml, so this is not an instance directory`);
  const cfgRaw = (readYaml(enginePath) ?? {}) as Raw;
  const config: InstanceConfig = {
    ...cfgRaw,
    name: String(cfgRaw.name ?? basename(dir)),
    title: String(cfgRaw.title ?? cfgRaw.name ?? basename(dir)),
    description: str(cfgRaw.description),
    packs: strList(cfgRaw.packs) ?? ["generic"],
    ladder: strList(cfgRaw.ladder) ?? DEFAULT_LADDER,
  };
  if (config.description === undefined) delete config.description;
  // Imported releases retain the published model and units beside the byte-identical stamp. Engine adapters
  // have distinct names so verifying the published files never compares them with a converted model.
  const designFile = (f: string) => f === "model.yaml" && adapters ? adapters.model : f === "plan.yaml" && adapters ? adapters.plan : f;
  const modelPath = join(src, designFile("model.yaml")), planPath = join(src, designFile("plan.yaml"));
  const modelRaw = existsSync(modelPath) ? (readYaml(modelPath) as Raw) : undefined;
  const model = normModel(modelRaw);
  const planRaw = existsSync(planPath) ? (readYaml(planPath) as Raw) : undefined;
  const plan = normPlan(planRaw);
  // The schema: none and no 0.4 key is 0.3, read in silence (every lone instance); a newer one throws (src/core/schema.ts).
  const schema = readSchema(cfgRaw, dir, list(planRaw?.units));
  const is04 = schema.read === "0.4";
  const loadFindings: Finding[] = duplicateKeyFindings(dir, design);
  if (!is04) loadFindings.push(...schema.findings);
  // A status override that is not whole fails loudly: an error at the milestone, and it is not applied.
  for (const ph of list(planRaw?.phases)) if (ph.override != null) {
    const bad = overrideProblem(ph.override);
    if (bad) loadFindings.push(overrideFinding(String(ph.id), "plan.yaml", bad));
  }
  const milestoneProblems = [
    ...applyMilestones(dir, plan, loadFindings), // <instance>/milestones.yaml, when the milestones' words live beside a generated plan
    ...applyProgress(dir, plan, loadFindings, { flowItems: is04 }), // <instance>/progress.yaml: unit status set by a person, kept beside the plan; a 0.4 design's flow items too
  ];
  const patches: Patch[] = [];
  const readPatches = (pd: string, keep: (p: Patch) => boolean) => {
    const pdir = join(dir, pd);
    if (!existsSync(pdir)) return;
    const files = readdirSync(pdir).filter((f) => /\.ya?ml$/.test(f)).sort(natCompare);
    for (const f of files) {
      const rel = `${pd}/${f}`;
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(join(pdir, f), "utf8"),join(pdir,f));
      } catch (e) {
        loadFindings.push(patchProblem(rel, `${rel}: YAML parse error: ${(e as Error).message}; the patch is skipped`));
        continue;
      }
      if (raw === null || raw === undefined) raw = {};
      if (typeof raw !== "object" || Array.isArray(raw)) {
        loadFindings.push(patchProblem(rel, `${rel}: a patch file must be a mapping (id, title, status, why, ops), not a ${Array.isArray(raw) ? "list" : typeof raw}; the patch is skipped`));
        continue;
      }
      const p = normPatch(raw as Raw, rel, loadFindings);
      if (keep(p)) patches.push(p);
    }
  };
  if (!edition) readPatches("patches", () => true);
  else {
    // the edition's accepted patches are its design; the instance's proposed ones are live, and shown against it
    readPatches(`${design}/patches`, () => true);
    const frozen = new Set(patches.map((p) => p.id));
    readPatches("patches", (p) => p.status === "proposed" && !frozen.has(p.id));
  }
  patches.sort((a, b) => natCompare(a.id, b.id) || natCompare(a.file ?? "", b.file ?? ""));
  const byId = new Map<string, Patch[]>();
  for (const p of patches) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  for (const [id, ps] of byId) if (ps.length > 1)
    loadFindings.push({ pack: "core", rule: "patch-ids-unique", severity: "error", at: id, atKind: "instance",
      message: `${ps.length} patch files share the id "${id}" (${ps.map((p) => p.file ?? "?").join(", ")}); give each its own id` });
  const tracker = loadTracker(dir); // <instance>/tracker/, when the instance is wired to a tracker
  const tour = loadTour(dir); // <instance>/tour.yaml, when the instance has a presentation tour
  let notes = loadNotes(dir); // <instance>/notes.yaml, when anyone has pinned a note or a question
  const inst: Instance = { dir, config, model, plan, patches, ...(tracker ? { tracker } : {}),
    ...(tour.tour ? { tour: tour.tour } : {}), ...(tour.problems.length ? { tourProblems: tour.problems } : {}), ...(notes ? { notes } : {}), ...(milestoneProblems.length ? { milestoneProblems } : {}) };
  if (edition) inst.edition = edition;
  if (schema.warnings.length) inst.loadWarnings = [...schema.warnings];
  if (is04) {
    // A 0.4 design: its namespace, root and pins; its own module seams; deprecated keys read through the new ones;
    // engine.yaml's references and notes' targets in canonical form. Records are resolved when compiled (src/core/resolve.ts).
    const ns = readNamespace(cfgRaw, dir, config, schema, opts);
    inst.ns = ns;
    if (inst.tracker && ns.namespace) inst.tracker.namespace = ns.namespace; // its own unit labels: de-unit:<namespace>:<unit>
    if (Array.isArray(modelRaw?.seams)) model.seams = list(modelRaw!.seams).map(normSeam);
    // current.yaml: live state, always from the instance folder, never from a released edition (src/core/current.ts)
    const current = loadCurrent(dir);
    if (current) inst.current = current;
    if (ns.namespace) for (const p of patches) for (const op of p.ops) if (op && typeof op === "object" && "id" in op && typeof op.id === "string" && parseRef(op.id).ns === ns.namespace) op.id = parseRef(op.id).id;
    ns.findings.push(...deprecatedKeyFindings(dir));
    if (inst.tour) inst.tour = { ...inst.tour, steps: inst.tour.steps.map((st) => ({ ...st, target: renameGate(st.target) })) };
    const root = ns.root?.input;
    if (ns.namespace || root) {
      const cc = canonicalConfig(config, ns.namespace, root, model, plan);
      inst.config = cc.config;
      ns.findings.push(...cc.findings);
      if (notes) notes = inst.notes = { ...notes, notes: canonicalNotes(notes.notes, ns.namespace, root, model, plan) };
    }
  }
  if (loadFindings.length) inst.loadFindings = loadFindings;
  return inst;
}
