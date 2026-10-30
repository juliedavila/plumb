// The portfolio: composition, the lock, and the portfolio's checks and impact as
// data. src/site/portfolio.ts renders the page; src/core/capacity.ts computes capacity and load.
//
// A portfolio is portfolio.yaml: a root and a list of designs, nothing else. A build of it:
//   1. loads the root once, and every design against it: the working copies ("working"), or each design's newest
//      released edition with today's live state ("presenting"; a design with none shows its working copy, labelled);
//   2. builds each design with the others composed beside it, so its pins, its references into other designs and the
//      root's references into it are checked, and keeps its findings;
//   3. composes every design and the shared layer into one namespaced graph (own records "<ns>:<id>", the shared layer's
//      "shared:<id>", the org layer's teams "org:<id>") and runs over it the packs whose rules read across records, as
//      the designs list them: generic, security, and any pack that sets composable: true. A finding the union has and no
//      design built alone has is reported as found only with the designs composed; the plan pack never runs there;
//   4. checks the root with every design composed beside it (src/core/root-build.ts: the org and shared packs, and the
//      marks from computeMarks), judges every crossing (src/core/seams.ts) with those marks, and runs the portfolio pack
//      with RuleContext.portfolio set;
//   5. reports every finding once, and hides none: the portfolio's own over a design's, a record's home design over
//      another's, as many of each as the most of any one build has;
//   6. writes portfolio.lock: which editions each mode composed, and the root it composed them over.
// References into a design the portfolio does not compose are skipped with a note, so one root can serve more than
// one portfolio. A design whose schema this engine cannot read stops the build at that finding.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type {
  Bundle, ComposedDesign, Contract, Element, Finding, Instance, InstanceConfig, LockDesign, LockSection, Marks, Model, Phase, Plan,
  PortfolioData, PortfolioDesign, PortfolioFile, PortfolioFinding, PortfolioImpact, PortfolioLock, PortfolioMode, Relationship,
  RootInput, Team, Unit, View,
} from "../types.ts";
import { buildBundle, ENGINE_VERSION, modelHash } from "./bundle.ts";
import { compile } from "./compile.ts";
import { readerUnitTitle } from "./reader.ts";
import { DEFAULT_LADDER, loadInstance, packNames } from "./load.ts";
import { checkCompiled } from "./impact.ts";
import { loadRoot } from "./root.ts";
import { newestEdition } from "./edition.ts";
import { buildContext, loadPacks, packsFor, runRules } from "./rules.ts";
import { SchemaError } from "./schema.ts";
import { isNamespaced, ORG, parseRef, SHARED } from "./namespace.ts";
import { checkRoot } from "./root-build.ts";
import { designRef, rootRef, seamReport } from "./seams.ts";
import { canonicalJson, natCompare, sha256 } from "./util.ts";
import { loadDeltas, loadFacts } from "./capacity.ts";
import { estimateSettings } from "./org.ts";
import { loadMeasures, measureSummary } from "../tracker/measures.ts";

type Raw = Record<string, unknown>;
const clone = <T>(x: T): T => structuredClone(x);

// ---------- portfolio.yaml ----------

/** Read portfolio.yaml (or the folder holding it). Throws, in words, when it cannot be read as a portfolio. */
export function readPortfolio(pathIn: string): PortfolioFile {
  const p = resolve(pathIn);
  const path = existsSync(p) && statSync(p).isDirectory() ? join(p, "portfolio.yaml") : p;
  if (!existsSync(path)) throw new Error(`${relative(process.cwd(), path) || path}: no portfolio.yaml here`);
  let raw: unknown;
  try { raw = Bun.YAML.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`${path}: YAML parse error: ${(e as Error).message}`); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path}: a portfolio is a mapping (schema, name, title, root, designs)`);
  const r = raw as Raw;
  const dir = dirname(path);
  if (typeof r.root !== "string" || !r.root.trim()) throw new Error(`${path}: root must name the shared root's folder, relative to portfolio.yaml`);
  if (!Array.isArray(r.designs) || !r.designs.length) throw new Error(`${path}: designs must list { namespace, from } for each design it composes`);
  const designs = r.designs.map((d, i) => {
    const x = (d && typeof d === "object" ? d : {}) as Raw;
    if (typeof x.from !== "string" || typeof x.namespace !== "string") throw new Error(`${path}: designs[${i}] needs namespace and from (its folder, relative to portfolio.yaml)`);
    return { namespace: x.namespace, from: x.from };
  });
  const name = String(r.name ?? basename(dir));
  return {
    path, dir, ...(r.schema != null ? { schema: String(r.schema) } : {}), name, title: String(r.title ?? name), root: r.root, designs,
    presenting: String(r.presenting ?? "released"), working: String(r.working ?? "latest"),
    ...(typeof r.horizon_months === "number" ? { horizon_months: r.horizon_months } : {}),
  };
}

// ---------- the composed graph ----------

export interface ComposedGraph { model: Model; plan: Plan; config: InstanceConfig; notes: string[]; standIns: Set<string> }

type SecCfg = { outbound_systems?: string[]; execution_zones?: string[]; authorization_systems?: string[]; evidence_contracts?: string[]; proof_contracts?: string[]; context_contracts?: string[] };

/**
 * Every design and the shared layer as one graph, every id namespaced: a design's own records "<ns>:<id>", the shared
 * layer's "shared:<id>", the org layer's teams "org:<id>". A shared part's owner is a role, which the root's team map
 * gives to a team; the graph lists each role as a team-like record so references resolve. A record of a design the
 * portfolio does not compose, named by the shared layer or by a view, stands in as an outside part, and a crossing
 * that names one is skipped with a note. The security pack's settings are namespaced and merged.
 */
export function composeGraph(root: RootInput | undefined, designs: { d: ComposedDesign; config: InstanceConfig }[], name: string, title: string): ComposedGraph {
  const notes: string[] = [];
  const model: Model = { teams: [], systems: [], zones: [], elements: [], relationships: [], contracts: [], views: [], claims: [] };
  const plan: Plan = { phases: [], units: [] };
  const composed = new Set(designs.map((x) => x.d.namespace));
  const sh = root?.shared;
  const sharedCaps = new Set((sh?.capabilities ?? []).map((c) => c.id));
  const orgTeams = new Set((root?.org?.teams ?? []).map((t) => t.id));
  const roles = new Map<string, Team>();

  for (const { d } of designs) {
    const ns = d.namespace, q = (r: string) => designRef(ns, r);
    const ownContracts = new Set(d.model.contracts.filter((c) => !c.home).map((c) => c.name));
    const contractQ = (c: string) => (isNamespaced(c) ? designRef(ns, c) : ownContracts.has(c) || !sh?.contracts.some((x) => x.name === c) ? `${ns}:${c}` : `${SHARED}:${c}`);
    const capQ = (c: string) => { const r = parseRef(c); return r.ns ? `${r.ns}:${r.id}` : sharedCaps.has(c) ? `${SHARED}:${c}` : `${ns}:${c}`; };
    const attrsQ = (a: Element["attrs"]) => {
      if (!a) return a;
      const out = clone(a);
      for (const k of ["owner_teams", "decider", "not"]) {
        const v = out[k];
        if (typeof v === "string") out[k] = q(v); else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? q(x) : x));
      }
      if (Array.isArray(out.by_reference)) out.by_reference = out.by_reference.map((x) => (typeof x === "string" ? contractQ(x) : x));
      return out;
    };
    const opt = <T>(v: T | undefined, f: (x: T) => T) => (v === undefined ? undefined : f(v));
    const prune = <T extends object>(o: T): T => { for (const k of Object.keys(o)) if ((o as Raw)[k] === undefined) delete (o as Raw)[k]; return o; };
    for (const t of d.model.teams.filter((x) => !x.home)) model.teams.push({ ...clone(t), id: q(t.id), home: ns });
    for (const s of d.model.systems.filter((x) => !x.home)) model.systems.push({ ...clone(s), id: q(s.id), home: ns });
    for (const z of d.model.zones.filter((x) => !x.home)) model.zones.push({ ...clone(z), id: q(z.id), home: ns });
    for (const e of d.model.elements.filter((x) => !x.home)) model.elements.push(prune({
      ...clone(e), id: q(e.id), system: opt(e.system, q), zone: opt(e.zone, q), owner: opt(e.owner, q), verifier: opt(e.verifier, q), parent: opt(e.parent, q),
      rests_on: e.rests_on?.map(q), attrs: attrsQ(e.attrs), home: ns,
    }));
    for (const r of d.model.relationships.filter((x) => !x.home)) model.relationships.push(prune({
      ...clone(r), id: q(r.id), from: q(r.from), to: q(r.to), carries: r.carries?.map(q), rests_on: r.rests_on?.map(q), attrs: attrsQ(r.attrs), home: ns,
    } as Relationship));
    for (const c of d.model.contracts.filter((x) => !x.home)) model.contracts.push(prune({ ...clone(c), name: q(c.name), produced_by: c.produced_by?.map(q), consumed_by: c.consumed_by?.map(q), home: ns } as Contract));
    for (const c of (d.model.claims ?? []).filter((x) => !x.home)) {
      const cc = { ...clone(c), id: q(c.id), rests_on: c.rests_on?.map(q), home: ns };
      if (Array.isArray(cc.attrs?.tested_by)) cc.attrs!.tested_by = (cc.attrs!.tested_by as unknown[]).map((x) => (typeof x === "string" ? q(x) : x));
      model.claims!.push(prune(cc));
    }
    for (const v of d.model.views) model.views.push(prune({ ...clone(v), id: q(v.id), elements: v.elements.map(q), relationships: v.relationships?.map(q) } as View));
    for (const ph of d.plan.phases) plan.phases.push(prune({ ...clone(ph), id: q(ph.id), rests_on: ph.rests_on?.map(q) } as Phase));
    for (const u of d.plan.units) {
      const uu = prune({
        ...clone(u), title: readerUnitTitle(u, sh?.capabilities), id: q(u.id), phase: q(u.phase), elements: u.elements?.map((m) => ({ ...m, id: q(m.id) })),
        requires: u.requires?.map(capQ), provides: u.provides?.map(capQ), owner: opt(u.owner, q), verifier: opt(u.verifier, q), rests_on: u.rests_on?.map(q),
      } as Unit);
      const rel = (uu as unknown as Raw).relieves;
      if (Array.isArray(rel)) (uu as unknown as Raw).relieves = rel.map((x) => (x && typeof x === "object" && typeof (x as Raw).rests_on === "string" ? { ...(x as Raw), rests_on: q((x as Raw).rests_on as string) } : x));
      plan.units.push(uu);
    }
  }

  // the shared layer, as the root holds it (with the organization's accepted patches)
  const reaches = (ref: string) => { const ns = parseRef(ref).ns; return !ns || ns === SHARED || ns === ORG || composed.has(ns); };
  const ownerOf = (o: string | undefined) => {
    if (!o) return o;
    if (orgTeams.has(o)) return `${ORG}:${o}`;
    if (isNamespaced(o)) return rootRef(o);
    if (!roles.has(o)) roles.set(o, { id: o, name: o, description: "A role the shared layer names; the root's team map says which team holds it.", home: SHARED });
    return o;
  };
  for (const s of sh?.systems ?? []) model.systems.push({ ...clone(s), id: rootRef(s.id), home: SHARED });
  for (const z of sh?.zones ?? []) model.zones.push({ ...clone(z), id: rootRef(z.id), home: SHARED });
  for (const p of sh?.parts ?? []) {
    const e: Element = { ...clone(p), id: rootRef(p.id), home: SHARED };
    if (p.system) e.system = rootRef(p.system);
    if (p.zone) e.zone = rootRef(p.zone);
    if (p.parent) e.parent = rootRef(p.parent);
    if (p.rests_on) e.rests_on = p.rests_on.map(rootRef);
    const o = ownerOf(p.owner); if (o) e.owner = o;
    model.elements.push(e);
  }
  for (const c of sh?.claims ?? []) model.claims!.push({ ...clone(c), id: rootRef(c.id), ...(c.rests_on ? { rests_on: c.rests_on.map(rootRef) } : {}), home: SHARED });
  for (const c of sh?.contracts ?? []) {
    const con: Contract = { ...clone(c), name: rootRef(c.name), home: SHARED };
    if (c.produced_by) con.produced_by = c.produced_by.map(rootRef);
    if (c.consumed_by) con.consumed_by = c.consumed_by.map(rootRef);
    model.contracts.push(con);
  }
  for (const x of sh?.crossings ?? []) {
    const ends = [x.from, x.to].map(rootRef);
    const off = ends.filter((e) => !reaches(e)).map((e) => parseRef(e).ns!);
    if (off.length) { notes.push(`The shared layer's crossing ${x.id} names ${[...new Set(off)].join(" and ")}, which this portfolio does not compose; it is skipped.`); continue; }
    const rel: Relationship = { ...clone(x), id: rootRef(x.id), from: ends[0], to: ends[1], home: SHARED };
    if (x.carries) rel.carries = x.carries.map(rootRef);
    if (x.rests_on) rel.rests_on = x.rests_on.map(rootRef);
    model.relationships.push(rel);
  }
  for (const t of root?.org?.teams ?? []) model.teams.push({ ...clone(t), id: `${ORG}:${t.id}`, home: ORG });
  model.teams.push(...roles.values());

  // records of designs the portfolio does not compose, named by the shared layer or a view: outside parts, so references resolve
  const standIns = new Set<string>();
  const have = new Set(model.elements.map((e) => e.id));
  const standIn = (ref: string) => {
    const r = parseRef(ref);
    if (!r.ns || r.ns === SHARED || r.ns === ORG || composed.has(r.ns) || have.has(ref)) return;
    have.add(ref); standIns.add(ref);
    model.elements.push({ id: ref, name: sh?.names[ref] ?? r.id, kind: "part", home: r.ns });
  };
  for (const c of model.contracts) for (const x of [...(c.produced_by ?? []), ...(c.consumed_by ?? [])]) standIn(x);
  for (const v of model.views) for (const x of v.elements) standIn(x);
  if (standIns.size) notes.push(`${standIns.size === 1 ? "One part" : `${standIns.size} parts`} of designs this portfolio does not compose ${standIns.size === 1 ? "is" : "are"} named by the shared layer or a view and stand${standIns.size === 1 ? "s" : ""} in as outside parts: ${[...standIns].sort(natCompare).join(", ")}.`);

  return { model, plan, config: composedConfig(root, designs, name, title), notes, standIns };
}

/** The composed graph's config: the security pack's settings namespaced and merged, each design's list or its default. */
function composedConfig(root: RootInput | undefined, designs: { d: ComposedDesign; config: InstanceConfig }[], name: string, title: string): InstanceConfig {
  const sec: SecCfg = {};
  const zones = new Set<string>();
  const sharedZones = new Set((root?.shared?.zones ?? []).map((z) => z.id));
  const lists = { outbound_systems: [] as string[][], authorization_systems: [] as string[][] };
  const explicit = { outbound_systems: false, authorization_systems: false };
  for (const { d, config } of designs) {
    const s = (config.security ?? {}) as SecCfg, ns = d.namespace;
    for (const field of ["evidence_contracts","proof_contracts","context_contracts"] as const) {
      if (Array.isArray(s[field])) sec[field] = [...new Set([...(sec[field] ?? []),...s[field]!.map(name => designRef(ns,String(name)))])].sort(natCompare);
    }
    if (Array.isArray(s.execution_zones)) for (const z of s.execution_zones) zones.add(designRef(ns, String(z)));
    else {
      // the default, ["execution"], names a zone called execution: the design's own, else the shared layer's
      if (d.model.zones.some((z) => !z.home && z.id === "execution")) zones.add(`${ns}:execution`);
      else if (sharedZones.has("execution")) zones.add(`${SHARED}:execution`);
    }
    for (const k of ["outbound_systems", "authorization_systems"] as const) {
      if (Array.isArray(s[k])) { explicit[k] = true; lists[k].push(s[k]!.map((x) => designRef(ns, String(x)))); continue; }
      const mark = k === "outbound_systems" ? "model_boundary" : "grants_authority";
      lists[k].push([...new Set(d.model.elements.filter((e) => e.attrs?.[mark] === true && e.system).map((e) => designRef(ns, e.system!)))]);
    }
  }
  sec.execution_zones = [...zones].sort(natCompare);
  for (const k of ["outbound_systems", "authorization_systems"] as const) if (explicit[k]) sec[k] = [...new Set(lists[k].flat())].sort(natCompare);
  return { name, title, packs: ["generic", "security"], ladder: DEFAULT_LADDER, security: sec };
}

// ---------- the build ----------

export interface PortfolioOptions {
  mode?: PortfolioMode;
  current?: PortfolioRun;                // impact only: this build as it stands (its root as loaded from disk), reused for that side instead of composing it again
  built?: string;                        // ISO time of the build; its date judges dates (exception ends, ages)
  root?: RootInput;                      // the root already loaded (impact's variants, a test); default: loaded from portfolio.yaml root
}

export interface DesignRun {
  namespace: string;                     // the design's own namespace (portfolio.yaml's when it declares none)
  listedAs: string;                      // portfolio.yaml's namespace for it
  from: string; dir: string;
  edition?: string;
  composed?: ComposedDesign;
  inst?: Instance;
  bundle?: Bundle;
  findings: Finding[];                   // its own build in the portfolio, with the other designs composed beside it
  alone: Finding[];                      // its composable packs' findings built alone: what "found only with the designs composed" is measured against
}

export interface PortfolioRun {
  file: PortfolioFile;
  mode: PortfolioMode;
  root: RootInput;
  designs: DesignRun[];
  graph?: ComposedGraph;
  data: PortfolioData;
  rootCheck?: Awaited<ReturnType<typeof checkRoot>>; // the root checked with every design composed: its org view (with measured values), marks and findings (the page reads it)
}

const severityRank = (f: Finding) => (f.severity === "error" ? 0 : 1);
const RECORD_KINDS = new Set(["element", "relationship", "contract", "team", "system", "zone", "unit", "phase", "view", "claim"]);

/** Whose file a root finding on a whole file sits on: the shared layer's (seams.yaml, manual-work.yaml), the org layer's (org.yaml), or the root's. */
const rootFileNs = (at: string) => (/^(seams|manual-work)\.yaml$/.test(at) ? SHARED : at === "org.yaml" ? ORG : "root");

/** A design's finding as the portfolio reports it: its record namespaced, its design named. */
function fromDesign(ns: string, f: Finding): PortfolioFinding {
  if (RECORD_KINDS.has(f.atKind)) { const at = isNamespaced(f.at) ? f.at : `${ns}:${f.at}`; return { ...f, at, design: ns, subject: at }; }
  return { ...f, design: ns, subject: isNamespaced(f.at) ? f.at : `${ns} (${f.at})` }; // a root record (org:chores) is its own subject
}

/** A message with every namespace prefix dropped, so a design's own words and the composed graph's compare. */
const plainIds = (m: string) => m.replace(/(?<![A-Za-z0-9_.-])[a-z][a-z0-9-]{0,23}:(?=[^\s/])/g, "");

/**
 * The identity of a finding across builds: a finding on a record is its rule, its record and its words (namespaces
 * dropped), so two findings of one rule on one record stay two; a finding on a design as a whole is its rule and its
 * words, so a pin loop two designs both see is one finding.
 */
const findingKey = (f: PortfolioFinding) => (RECORD_KINDS.has(f.atKind) ? `${f.pack}\u0000${f.rule}\u0000${f.subject}\u0000${plainIds(f.message)}` : `${f.pack}\u0000${f.rule}\u0000${plainIds(f.message)}`);

const COMPOSED_ONLY = " (found only with the designs composed)";

/**
 * Every finding once, and none hidden. The portfolio's own packs answer for their rules: a design's finding of the
 * same rule on the same subject is theirs too (alsoIn). Every other finding is reported as many times as the most of
 * any one build has it: first as the designs found it (a record's home design first), as many as a design built alone
 * finds; the rest are found only with the designs composed, taken from the composed graph first.
 */
function mergeFindings(own: PortfolioFinding[], composed: PortfolioFinding[], designs: { ns: string; fs: PortfolioFinding[]; alone: PortfolioFinding[] }[], composedPacks: Set<string>): PortfolioFinding[] {
  const out: PortfolioFinding[] = [...own];
  const ownSubjects = new Map<string, PortfolioFinding>();
  for (const f of own) ownSubjects.set(`${f.pack}\u0000${f.rule}\u0000${RECORD_KINDS.has(f.atKind) ? f.subject : plainIds(f.message)}`, f);
  const group = (fs: PortfolioFinding[]) => { const m = new Map<string, PortfolioFinding[]>(); for (const f of fs) (m.get(findingKey(f)) ?? m.set(findingKey(f), []).get(findingKey(f))!).push(f); return m; };
  const byDesign = designs.map((d) => ({ ns: d.ns, fs: group(d.fs.filter((f) => {
    const o = ownSubjects.get(`${f.pack}\u0000${f.rule}\u0000${RECORD_KINDS.has(f.atKind) ? f.subject : plainIds(f.message)}`);
    if (o && f.design && f.design !== o.design && !(o.alsoIn ??= []).includes(f.design)) o.alsoIn.push(f.design);
    return !o;
  })), alone: group(d.alone) }));
  const fromComposed = group(composed);
  const keys = new Set([...fromComposed.keys(), ...byDesign.flatMap((d) => [...d.fs.keys()])]);
  for (const key of keys) {
    const sources = byDesign.filter((d) => d.fs.has(key));
    const home = (d: { ns: string; fs: Map<string, PortfolioFinding[]> }) => { const f = d.fs.get(key)![0]; return RECORD_KINDS.has(f.atKind) && parseRef(f.subject).ns === d.ns ? 0 : 1; };
    sources.sort((a, b) => home(a) - home(b));
    const c = fromComposed.get(key) ?? [];
    const n = Math.max(c.length, ...sources.map((d) => d.fs.get(key)!.length));
    // a pack the composed graph does not run (core, plan, teams...) is the designs' own: nothing of it is composed-only
    const pack = (c[0] ?? sources[0]?.fs.get(key)![0])!.pack;
    const alone = composedPacks.has(pack) ? Math.min(n, Math.max(0, ...byDesign.map((d) => d.alone.get(key)?.length ?? 0))) : n;
    const also = (taken: PortfolioFinding) => { const others = sources.map((d) => d.ns).filter((ns) => ns !== taken.design); if (others.length) taken.alsoIn = [...new Set([...(taken.alsoIn ?? []), ...others])].sort(natCompare); return taken; };
    const pool = sources.flatMap((d) => d.fs.get(key)!);
    let pi = 0, ci = 0, taken = 0;
    // as many as a design built alone sees: the designs' own words first
    while (taken < alone && (pi < pool.length || ci < c.length)) { out.push(also({ ...(pi < pool.length ? pool[pi++] : c[ci++]) })); taken++; }
    // the rest are seen only with the designs composed: the composed graph's first
    while (taken < n && (ci < c.length || pi < pool.length)) {
      const f = ci < c.length ? c[ci++] : pool[pi++];
      out.push(also({ ...f, composedOnly: true, message: f.message.endsWith(COMPOSED_ONLY) ? f.message : `${f.message}${COMPOSED_ONLY}` }));
      taken++;
    }
  }
  return out.sort((a, b) => severityRank(a) - severityRank(b) || natCompare(a.pack, b.pack) || natCompare(a.rule, b.rule) || natCompare(a.subject, b.subject) || natCompare(a.message, b.message));
}

/** Compose and check the portfolio: every design's own build, the composed checks, the seams and the portfolio's own packs. */
export async function runPortfolio(pathIn: string, opts: PortfolioOptions = {}): Promise<PortfolioRun> {
  const file = readPortfolio(pathIn);
  const mode: PortfolioMode = opts.mode ?? "working";
  const built = opts.built ?? new Date().toISOString();
  const today = /^\d{4}-\d{2}-\d{2}/.test(built) ? built.slice(0, 10) : undefined;
  const rootDir = resolve(file.dir, file.root);
  const root = opts.root ?? loadRoot(rootDir);
  const own: PortfolioFinding[] = [];
  const pf = (rule: string, severity: Finding["severity"], at: string, message: string, pack = "core"): PortfolioFinding => ({ pack, rule, severity, at, atKind: "instance", message, subject: at });

  // 1. each design, compiled for composition: its working copy, or (presenting) its newest released edition
  const runs: DesignRun[] = [];
  const stopped: PortfolioFinding[] = [];
  for (const e of file.designs) {
    const dir = resolve(file.dir, e.from);
    const run: DesignRun = { namespace: e.namespace, listedAs: e.namespace, from: e.from, dir, findings: [], alone: [] };
    runs.push(run);
    if (mode === "presenting") { try { run.edition = newestEdition(dir)?.version; } catch { run.edition = undefined; } }
    try {
      const inst = loadInstance(dir, { ...(run.edition ? { edition: run.edition } : {}), root });
      const c = compile(inst);
      run.namespace = inst.ns?.namespace ?? e.namespace;
      if (run.namespace !== e.namespace) own.push(pf("xref-resolves", "error", e.namespace, `portfolio.yaml lists ${e.from} as ${e.namespace}, and its engine.yaml says namespace ${run.namespace}; the portfolio composes it as ${run.namespace}`));
      run.composed = {
        namespace: run.namespace, dir: inst.dir, title: inst.config.title,
        ...(run.edition ? { edition: run.edition, editionSha256: inst.edition!.sha256 } : {}),
        model: c.model, plan: c.plan, pins: inst.ns?.pins ?? [],
      };
      // the design built alone, as its own page outside the portfolio sees it: the baseline for the composed checks
      const packs = packsFor((await loadPacks(packNames(inst))).packs, !!inst.ns); // the rule set the design's own build runs
      run.alone = checkCompiled(inst, c, packs.filter((x) => x.name === "generic" || x.name === "security" || x.composable === true));
    } catch (err) {
      if (err instanceof SchemaError) { stopped.push({ ...err.finding, design: e.namespace, subject: `${e.namespace} (${err.finding.at})` }); continue; }
      own.push(pf("xref-resolves", "error", e.namespace, `portfolio.yaml lists ${e.from} as ${e.namespace}, which does not load as a design: ${(err as Error).message}`));
    }
  }
  const lockOf = () => lockSection(file, mode, built, root, runs);
  if (stopped.length) {
    // a schema this engine cannot read stops the build: that finding, and nothing else
    const data: PortfolioData = {
      engine: { version: ENGINE_VERSION, built }, portfolio: portfolioWords(file, mode), designs: runs.map((r) => designWords(r, mode, file)),
      findings: stopped, seams: { seams: [], crossings: [], undeclared: [], marksAvailable: false, notes: [] }, notes: [], lock: lockOf(), stopped: true,
    };
    return { file, mode, root, designs: runs, data };
  }

  // 2. each design's own build, with the others composed beside it
  const composed = runs.filter((r) => r.composed).map((r) => r.composed!);
  for (const run of runs.filter((r) => r.composed)) {
    const others = composed.filter((d) => d !== run.composed);
    const inst = loadInstance(run.dir, { ...(run.edition ? { edition: run.edition } : {}), compose: others, root });
    const { bundle } = await buildBundle(inst, { built });
    run.inst = inst; run.bundle = bundle; run.findings = bundle.findings;
  }

  // 3. the composed graph and the packs that read across records
  const withConfig = runs.filter((r) => r.composed && r.inst).map((r) => ({ d: r.composed!, config: r.inst!.config }));
  const graph = composeGraph(root, withConfig, file.name, file.title);
  // the packs that read across records (generic, security, and any that sets composable: true), as the designs list them
  const listed = [...new Set(runs.flatMap((r) => r.inst?.config.packs ?? []))];
  const candidates = packsFor((await loadPacks(listed)).packs, true); // the composed graph is read as 0.4
  const composable = candidates.filter((p) => p.name === "generic" || p.name === "security" || p.composable === true);
  const cctx = buildContext(graph.config, graph.model, graph.plan);
  if (today) cctx.today = today;
  const composedRaw = runRules(composable, cctx).filter((f) => !graph.standIns.has(f.at));

  // 4. the root checked with every design composed beside it (src/core/root-build.ts: its org and shared packs, and the
  // marks, src/core/shared.ts), the seams, and the portfolio's own pack
  let rootCheck: Awaited<ReturnType<typeof checkRoot>> | undefined;
  try { rootCheck = await checkRoot(root, { built, compose: composed }); } catch (err) { own.push(pf("xref-resolves", "error", "portfolio", `the root ${file.root} could not be checked: ${(err as Error).message}`)); }
  for (const f of rootCheck?.findings ?? []) own.push({ ...f, subject: RECORD_KINDS.has(f.atKind) || isNamespaced(f.at) ? f.at : `${rootFileNs(f.at)} (${f.at})` });
  const marks: Marks | undefined = rootCheck?.check.marks;
  const seams = seamReport({ root, designs: composed, ...(marks ? { marks } : {}), marksAvailable: !!marks, ...(today ? { today } : {}) });
  const roots: Record<string, { dir?: string; written?: string }> = {};
  for (const r of runs) if (r.inst) roots[r.namespace] = { ...(r.inst.ns?.root ? { dir: r.inst.ns.root.dir, written: r.inst.ns.root.path } : {}) };
  // load by team across the designs (src/core/capacity.ts): what team-over-capacity reads, and the page's load views
  const measures = loadMeasures(root.dir);
  const latest = measures.length ? measureSummary(measures[measures.length - 1], rootCheck?.check.org, estimateSettings(root).gap.capacity) : undefined;
  const load = loadFacts({
    root, ...(rootCheck?.check.org ? { org: rootCheck.check.org } : {}),
    designs: runs.filter((r) => r.composed && r.inst).map((r) => ({ ...r.composed!, imported: !!r.inst!.config.importer, ...(r.bundle?.current ? { transition: r.bundle.current.transition } : {}) })),
    graph: { model: graph.model, plan: graph.plan }, ...(today ? { today } : {}), ...(file.horizon_months !== undefined ? { horizonMonths: file.horizon_months } : {}),
    ...(latest ? { measure: latest } : {}),
  });
  const { packs: portfolioPacks } = await loadPacks(["portfolio"]);
  const pctx = buildContext(graph.config, graph.model, graph.plan);
  if (today) pctx.today = today;
  if (rootCheck) pctx.root = rootCheck.check; // what the root's packs read, for the portfolio's rules that need the org layer
  pctx.portfolio = { name: file.name, designs: composed, mode, root, rootWritten: file.root, roots, seams, ...(marks ? { marks } : {}), composed: { model: graph.model, plan: graph.plan }, ...(load ? { load } : {}) };
  for (const f of runRules(portfolioPacks, pctx)) own.push({ ...f, subject: f.at });

  // 5. every finding once, and none hidden
  const findings = mergeFindings(own, composedRaw.map((f) => ({ ...f, subject: f.at })),
    runs.filter((r) => r.composed).map((r) => ({ ns: r.namespace, fs: r.findings.map((f) => fromDesign(r.namespace, f)), alone: r.alone.map((f) => fromDesign(r.namespace, f)) })),
    new Set(composable.map((p) => p.name)));

  const data: PortfolioData = {
    engine: { version: ENGINE_VERSION, built }, portfolio: portfolioWords(file, mode),
    designs: runs.map((r) => designWords(r, mode, file)),
    findings, seams, ...(marks ? { marks } : {}),
    notes: [...graph.notes, ...seams.notes.filter((n) => !graph.notes.includes(n)), ...(marks ? [] : ["No mark derivation reached this build (src/core/shared.ts computeMarks), so every undeclared crossing counts as security-relevant."]),
      ...(load?.notes ?? []).filter((n) => !graph.notes.includes(n))],
    lock: lockOf(),
    ...(load ? { load } : {}),
  };
  return { file, mode, root, designs: runs, graph, data, ...(rootCheck ? { rootCheck } : {}) };
}

function portfolioWords(file: PortfolioFile, mode: PortfolioMode): PortfolioData["portfolio"] {
  return { name: file.name, title: file.title, mode, root: file.root, ...(file.horizon_months !== undefined ? { horizon_months: file.horizon_months } : {}), file: basename(file.path) };
}

function designWords(r: DesignRun, mode: PortfolioMode, file: PortfolioFile): PortfolioDesign {
  const rel = (d: string) => relative(file.dir, d) || ".";
  const inst = r.inst, ed = inst?.edition;
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const sr = r.edition ? undefined : sinceRelease(r);
  return {
    namespace: r.namespace, title: r.composed?.title ?? inst?.config.title ?? r.namespace, dir: rel(r.dir), from: r.from,
    ...(r.edition ? { edition: r.edition } : {}), ...(ed?.stamp.date ? { editionDate: ed.stamp.date } : {}), ...(ed ? { editionSha256: ed.sha256 } : {}),
    label: designLabel(r, mode),
    ...(inst?.ns?.root ? { root: rel(inst.ns.root.dir) } : {}),
    ...(inst ? { modelHash: modelHash(inst).slice(0, 12) } : {}),
    ...(sr ? { sinceRelease: sr } : {}),
    counts: { errors, warnings: r.findings.length - errors },
  };
}

/** How the page labels what was composed: a released edition, the working copy, or (presenting) a working copy for want of a release. */
function designLabel(r: DesignRun, mode: PortfolioMode): string {
  if (r.edition) { const d = r.inst?.edition?.stamp.date; return `${r.edition}${d ? `, released ${d}` : ""}`; }
  return mode === "presenting" ? "no released edition; working copy shown" : "working copy";
}

/** A working copy after a release: the newest released version, and the accepted patches the working copy has that it did not freeze. */
function sinceRelease(r: DesignRun): { version: string; accepted_patches: number } | undefined {
  let ed;
  try { ed = newestEdition(r.dir); } catch { return undefined; }
  if (!ed || !r.inst) return undefined;
  const frozen = new Set<string>();
  const pd = join(ed.dir, "patches");
  if (existsSync(pd)) for (const f of readdirSync(pd).filter((x) => /\.ya?ml$/.test(x))) {
    try { const p = Bun.YAML.parse(readFileSync(join(pd, f), "utf8")) as Raw; if (p?.id != null) frozen.add(String(p.id)); } catch { /* unreadable: not frozen */ }
  }
  return { version: ed.version, accepted_patches: r.inst.patches.filter((p) => p.status === "accepted" && !frozen.has(p.id)).length };
}

// ---------- the lock ----------

/** The root a build composed over: its hash (everything its build rests on, src/core/root.ts), the shipped shared file's, and its accepted patches. */
export function rootStamp(root: RootInput): LockSection["root"] {
  const hash = (root.hash ?? sha256(canonicalJson({ dir: basename(root.dir), config: root.config }))).slice(0, 12);
  const shipped = root.shipped ?? root.shared;
  return { hash, ...(shipped ? { shared_sha256: shipped.sha256.slice(0, 12) } : {}), accepted_patches: (root.patches ?? []).filter((p) => p.status === "accepted").length };
}

function lockSection(file: PortfolioFile, mode: PortfolioMode, built: string, root: RootInput, runs: DesignRun[]): LockSection {
  const designs: Record<string, LockDesign> = {};
  for (const r of runs) {
    if (r.edition && r.inst?.edition) { designs[r.namespace] = { edition: r.edition, ...(r.inst.edition.stamp.date ? { released: r.inst.edition.stamp.date } : {}), sha256: r.inst.edition.sha256.slice(0, 12) }; continue; }
    const sr = sinceRelease(r);
    designs[r.namespace] = {
      edition: "latest", ...(r.inst ? { model: modelHash(r.inst).slice(0, 12) } : {}), ...(sr ? { since_release: sr } : {}),
      ...(mode === "presenting" ? { note: "no released edition; working copy shown" } : {}),
    };
  }
  return { built, root: rootStamp(root), designs };
}

/** portfolio.lock beside portfolio.yaml, as read: each mode's section, or nothing. */
export function readLock(file: PortfolioFile): PortfolioLock {
  const p = join(file.dir, "portfolio.lock");
  if (!existsSync(p)) return {};
  try { const r = Bun.YAML.parse(readFileSync(p, "utf8")) as PortfolioLock | null; return r && typeof r === "object" ? r : {}; } catch { return {}; }
}

/** portfolio.lock as text: the section this build wrote, and the other mode's as it was. */
export function lockYaml(lock: PortfolioLock): string {
  const v = (x: unknown): string => (typeof x === "number" ? String(x) : JSON.stringify(String(x)));
  const flow = (o: Record<string, unknown>): string => `{ ${Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${x && typeof x === "object" ? flow(x as Record<string, unknown>) : v(x)}`).join(", ")} }`;
  const lines = ["# portfolio.lock: written by bun plumb.ts portfolio build. Which editions each mode composed, over which root. Never edited by hand."];
  for (const mode of ["working", "presenting"] as const) {
    const s = lock[mode];
    if (!s) continue;
    lines.push(`${mode}:`, `  built: ${v(s.built)}`, `  root: ${flow(s.root as unknown as Record<string, unknown>)}`, "  designs:");
    for (const ns of Object.keys(s.designs)) lines.push(`    ${ns}: ${flow(s.designs[ns] as unknown as Record<string, unknown>)}`);
  }
  return lines.join("\n") + "\n";
}

/** Write this build's section into portfolio.lock, keeping the other mode's. */
export function writeLock(file: PortfolioFile, mode: PortfolioMode, section: LockSection): string {
  const lock = readLock(file);
  lock[mode] = section;
  const p = join(file.dir, "portfolio.lock");
  writeFileSync(p, lockYaml(lock));
  return p;
}

// ---------- impact of a root patch ----------

/**
 * The portfolio with and without one root patch (whatever its status): the findings it adds and resolves, and a
 * verdict. fail when it adds an error, caution when it adds a warning, pass otherwise. The root is loaded with the
 * patch applied, or without it (src/core/root.ts), and nothing on disk changes.
 */
export async function portfolioImpact(pathIn: string, patchRef: string, opts: PortfolioOptions = {}): Promise<PortfolioImpact> {
  const file = readPortfolio(pathIn);
  const rootDir = resolve(file.dir, file.root);
  const asIs = loadRoot(rootDir);
  const patches = asIs.patches ?? [];
  const p = patches.find((x) => x.file === patchRef || x.file === `patches/${patchRef}` || (x.file && basename(x.file) === patchRef)) ?? patches.find((x) => x.id === patchRef);
  if (!p) throw new Error(`the root ${relative(process.cwd(), rootDir) || rootDir} has no patch "${patchRef}"; it has ${patches.map((x) => x.id).join(", ") || "none"}`);
  const key = p.file ?? p.id;
  const accepted = p.status === "accepted";
  const without = accepted ? loadRoot(rootDir, { without: key }) : asIs;
  const withP = accepted ? asIs : loadRoot(rootDir, { with: key });
  const base = { ...(opts.mode ? { mode: opts.mode } : {}), ...(opts.built ? { built: opts.built } : {}) };
  // the side that is the root as it stands is the caller's build when it passes one (the page build does)
  const before = !accepted && opts.current ? opts.current : await runPortfolio(pathIn, { ...base, root: without });
  const after = accepted && opts.current ? opts.current : await runPortfolio(pathIn, { ...base, root: withP });
  const fkey = (f: PortfolioFinding) => `${f.pack}\u0000${f.rule}\u0000${f.subject}\u0000${f.severity}\u0000${f.message}`;
  const b = new Set(before.data.findings.map(fkey)), a = new Set(after.data.findings.map(fkey));
  const introduced = after.data.findings.filter((f) => !b.has(fkey(f)));
  const resolved = before.data.findings.filter((f) => !a.has(fkey(f)));
  const errs = introduced.filter((f) => f.severity === "error"), warns = introduced.filter((f) => f.severity === "warning");
  const level: PortfolioImpact["verdict"]["level"] = errs.length ? "fail" : warns.length ? "caution" : "pass";
  const say = (fs: PortfolioFinding[]) => fs.slice(0, 4).map((f) => `${f.pack}/${f.rule} on ${f.subject}`).join("; ") + (fs.length > 4 ? `; and ${fs.length - 4} more` : "");
  const reasons: string[] = [];
  if (errs.length) reasons.push(`It adds ${count(errs.length, "error")}: ${say(errs)}.`);
  if (warns.length) reasons.push(`It adds ${count(warns.length, "warning")}: ${say(warns)}.`);
  const verb = accepted ? "Keeping" : "Accepting";
  const findingsWords = !introduced.length && !resolved.length ? `${verb} ${p.id} changes no finding of the portfolio.`
    : `${verb} ${p.id} ${[introduced.length ? `adds ${count(introduced.length, "finding")} (${say(introduced)})` : "", resolved.length ? `resolves ${count(resolved.length, "finding")} (${say(resolved)})` : ""].filter(Boolean).join(" and ")}.`;
  // what moves for each team whose allowance or free slots it changes, the team it puts over or brings back first
  const teams = loadDeltas(before.data.load, after.data.load);
  const effect = [findingsWords, ...teams.map((t) => t.text)].join(" ");
  return { patch: p.id, title: p.title, status: p.status, file: p.file ?? `patches/${p.id}.yaml`, verdict: { level, reasons }, introduced, resolved, effect, ...(teams.length ? { teams } : {}) };
}

const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number, w: string) => `${NUM[n] ?? n} ${w}${n === 1 ? "" : "s"}`;

// ---------- words for the CLI ----------

/** Portfolio findings as Markdown, grouped like an instance's checks; each line names its design and what composing found. */
export function portfolioFindingsMd(data: PortfolioData): string {
  const fs = data.findings;
  const errors = fs.filter((f) => f.severity === "error"), warnings = fs.filter((f) => f.severity === "warning");
  const mode = data.portfolio.mode === "presenting" ? "presenting released editions" : "working copies";
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const out = [`# Checks: ${data.portfolio.title} (${mode})`, "", `${n(errors.length, "error")}, ${n(warnings.length, "warning")}.`, ""];
  for (const [label, xs] of [["Errors", errors], ["Warnings", warnings]] as const) {
    if (!xs.length) continue;
    out.push(`## ${label}`, "");
    let group = "";
    for (const f of xs) {
      const g = `${f.pack} / ${f.rule}`;
      if (g !== group) { if (group) out.push(""); out.push(`### ${g}`, ""); group = g; }
      const where = [f.design ? `in ${f.design}'s build` : "", f.alsoIn?.length ? `also in ${f.alsoIn.join(", ")}` : "", f.excepted_by ? `excepted by the ${f.excepted_by}` : ""].filter(Boolean).join("; ");
      out.push(`- \`${f.subject}\`${where ? ` (${where})` : ""}: ${f.message}`);
    }
    out.push("");
  }
  if (!fs.length) out.push("All checks pass.", "");
  if (data.notes.length) out.push("## Notes", "", ...data.notes.map((n) => `- ${n}`), "");
  return out.join("\n");
}

/** A root patch's impact as Markdown. */
export function portfolioImpactMd(im: PortfolioImpact, title: string): string {
  const f = (x: PortfolioFinding) => `- [${x.severity}] ${x.pack} / ${x.rule} on \`${x.subject}\`: ${x.message}`;
  return [
    `# Impact of root patch \`${im.patch}\` on ${title}: ${im.title}`, "", `Status: ${im.status} (${im.file}).`, "", im.effect, "",
    `## Verdict: ${im.verdict.level}`, "", ...(im.verdict.reasons.length ? im.verdict.reasons.map((r) => `- ${r}`) : ["- It adds no finding to the portfolio."]), "",
    "## Findings introduced", "", ...(im.introduced.length ? im.introduced.map(f) : ["None."]), "",
    "## Findings resolved", "", ...(im.resolved.length ? im.resolved.map(f) : ["None."]), "",
  ].join("\n");
}

