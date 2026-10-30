// The example portfolio and the portfolio fixtures: fictional data for engine 0.4's
// portfolio features, checked here for what holds before any 0.4 loader reads it. Every YAML file parses with no key
// written twice; every hash and pin is current; the tracker export is what its generator writes; every reference
// resolves by scope (a design's own record, then the shared layer's, then an org team; another design's
// records only in views and in claims' rests_on); and the README, expected.yaml and the variants agree on what each
// check should report. Portfolio tests compare builds against expected.yaml and variants against their variant.yaml.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { duplicateKeys } from "../src/core/yaml-keys.ts";

const DE = join(import.meta.dir, "..");
const EX = join(DE, "examples");
const FX = join(import.meta.dir, "fixtures/portfolio");
const HAVE_EX = existsSync(join(EX, "portfolio/portfolio.yaml")); // tests that read the examples skip when those examples are absent

const sha256 = (p: string) => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex");
const Y = (p: string): any => Bun.YAML.parse(readFileSync(p, "utf8"));
const walk = (dir: string, rel = ""): string[] => readdirSync(join(dir, rel), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(dir, rel ? `${rel}/${d.name}` : d.name) : [rel ? `${rel}/${d.name}` : d.name]));
const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Namespace, portfolio, root and current-state rules: each has at least one broken variant. */
const NEW_RULES = [
  "core/xref-resolves", "core/xref-pin-stale", "core/xref-no-cycle", "core/deprecated-key", "portfolio/seam-crossing-declared",
  "portfolio/no-cross-effort-cycle", "portfolio/team-over-capacity", "portfolio/unit-has-flow-item", "core/schema-known", "core/one-home",
  "portfolio/one-root", "org/estimate-valid", "org/estimate-stale", "org/shares-exceed-capacity", "org/slowdown-valid", "org/slowdown-overdue",
  "org/exception-valid", "shared/mark-valid", "shared/crossing-valid", "shared/file-intact", "core/current-valid", "plan/retire-before-replace",
];

// ── reference resolution ──────────────────────────────────────────────────────────

type Kind = "element" | "relationship" | "contract" | "unit" | "phase" | "claim" | "seam" | "system" | "zone" | "capability";
interface Design { ns: string; dir: string; eng: any; model: any; plan: any; progress?: any; current?: any; ids: Record<Kind, Set<string>> }
interface Root { dir: string; seams: any; org: any; teamMap: any; catalog: Set<string>; shared: Record<Kind, Set<string>>; teams: Set<string>; activities: Set<string>; patches: { file: string; p: any }[] }
const kinds = (): Record<Kind, Set<string>> => ({ element: new Set(), relationship: new Set(), contract: new Set(), unit: new Set(), phase: new Set(), claim: new Set(), seam: new Set(), system: new Set(), zone: new Set(), capability: new Set() });
const ids = (xs: any[] | undefined, key = "id") => (xs ?? []).map((x) => String(x[key]));
const opt = (p: string) => (existsSync(p) ? Y(p) : undefined);

function loadRoot(dir: string): Root {
  const seams = Y(join(dir, "seams.yaml")), org = opt(join(dir, "org.yaml")) ?? {}, teamMap = opt(join(dir, "team-map.yaml")) ?? {};
  const mw = opt(join(dir, "manual-work.yaml"));
  const shared = kinds();
  for (const i of ids(seams.parts)) shared.element.add(i);
  for (const [k, xs] of [["system", seams.systems], ["zone", seams.zones], ["claim", seams.claims], ["relationship", seams.crossings], ["capability", seams.capabilities], ["seam", seams.seams]] as const) for (const i of ids(xs)) shared[k].add(i);
  for (const n of ids(seams.contracts, "name")) shared.contract.add(n);
  const patches = existsSync(join(dir, "patches")) ? readdirSync(join(dir, "patches")).filter((f) => f.endsWith(".yaml")).sort().map((f) => ({ file: f, p: Y(join(dir, "patches", f)) })) : [];
  for (const { p } of patches) if (String(p.status) === "accepted") for (const op of p.ops ?? []) if (op.op === "add") {
    const k = op.kind as Kind;
    shared[k]?.add(String(k === "contract" ? op.value.name : op.value.id));
  }
  return { dir, seams, org, teamMap, catalog: new Set(ids([...(mw?.manual_work ?? []), ...(seams.manual_work ?? [])])), shared,
    teams: new Set(ids(org.teams)), activities: new Set(ids(org.activities)), patches };
}

function loadDesign(dir: string): Design {
  const eng = Y(join(dir, "engine.yaml")), model = opt(join(dir, "model.yaml")) ?? {}, plan = opt(join(dir, "plan.yaml")) ?? {};
  const current = opt(join(dir, "current.yaml"));
  const d: Design = { ns: eng.namespace, dir, eng, model, plan, progress: opt(join(dir, "progress.yaml")), current, ids: kinds() };
  for (const [k, xs] of [["element", model.elements], ["relationship", model.relationships], ["claim", model.claims], ["seam", model.seams], ["system", model.systems], ["zone", model.zones], ["unit", plan.units], ["phase", plan.phases]] as const) for (const i of ids(xs)) d.ids[k].add(i);
  for (const n of ids(model.contracts, "name")) d.ids.contract.add(n);
  for (const [id, r] of Object.entries<any>(current?.parts ?? {})) if (r?.add) d.ids.element.add(id);
  for (const u of plan.units ?? []) for (const c of u.provides ?? []) d.ids.capability.add(c);
  return d;
}

/** Every reference in a root and its designs that does not resolve, or that names another design where it may not. */
function refProblems(root: Root, designs: Design[]): string[] {
  const out: string[] = [];
  const byNs = new Map(designs.map((d) => [d.ns, d]));
  const split = (r: string): [string | undefined, string] => { const m = /^([a-z][a-z0-9-]{0,23}):(.+)$/.exec(r); return m ? [m[1], m[2]] : [undefined, r]; };
  /** A reference written in the root: into a design when namespaced, else the shared layer's own record. */
  const fromRoot = (r: string, kind: Kind, where: string) => {
    const [ns, id] = split(String(r));
    const ok = ns && ns !== "shared" ? byNs.get(ns)?.ids[kind].has(id) : root.shared[kind].has(id);
    if (!ok) out.push(`${where}: ${r} is no ${kind}`);
  };
  /** A reference written in a design: its own record, then the shared layer's; another design only where `other` allows. */
  const fromDesign = (d: Design, r: string, kind: Kind, where: string, other = false) => {
    const [ns, id] = split(String(r));
    if (ns === "shared") { if (!root.shared[kind].has(id)) out.push(`${d.ns} ${where}: ${r} is no shared ${kind}`); return; }
    if (ns && ns !== d.ns) {
      if (!other) out.push(`${d.ns} ${where}: names ${r} in another design`);
      else if (!byNs.get(ns)?.ids[kind].has(id)) out.push(`${d.ns} ${where}: ${r} is no ${kind}`);
      return;
    }
    if (!d.ids[kind].has(id) && !root.shared[kind].has(id)) out.push(`${d.ns} ${where}: ${r} resolves nowhere`);
  };
  const team = (t: string | undefined, where: string) => { if (t && !root.teams.has(split(t)[1])) out.push(`${where}: team ${t} is not in org.yaml`); };
  const role = (r: string, where: string) => { if (!root.teamMap.owners?.[r]) out.push(`${where}: role "${r}" is not in team-map.yaml`); };
  const end = (v: unknown, where: string) => { const s = String(v); if (!DATE.test(s)) fromRoot(s, "phase", where); };
  const s = root.seams;

  // the shared layer
  for (const p of s.parts ?? []) { role(p.owner, `part ${p.id}`); fromRoot(p.system, "system", `part ${p.id}`); fromRoot(p.zone, "zone", `part ${p.id}`); for (const c of p.rests_on ?? []) fromRoot(c, "claim", `part ${p.id}`); }
  const contracts = [...(s.contracts ?? []), ...root.patches.flatMap(({ p }) => (p.ops ?? []).filter((o: any) => o.op === "add" && o.kind === "contract").map((o: any) => o.value))];
  for (const c of contracts) for (const e of [...(c.produced_by ?? []), ...(c.consumed_by ?? [])]) fromRoot(e, "element", `contract ${c.name}`);
  const crossings = [...(s.crossings ?? []), ...root.patches.flatMap(({ p }) => (p.ops ?? []).filter((o: any) => o.op === "add" && o.kind === "relationship").map((o: any) => o.value))];
  for (const x of crossings) { fromRoot(x.from, "element", `crossing ${x.id}`); fromRoot(x.to, "element", `crossing ${x.id}`); for (const c of x.carries ?? []) fromRoot(c, "contract", `crossing ${x.id}`); if (!(x.carries ?? []).length) out.push(`crossing ${x.id} carries no contract`); }
  const caps = [...(s.capabilities ?? []), ...root.patches.flatMap(({ p }) => (p.ops ?? []).filter((o: any) => o.op === "add" && o.kind === "capability").map((o: any) => o.value))];
  for (const c of caps) for (const ns of [...c.provided_by, ...c.required_by]) if (!byNs.has(ns)) out.push(`capability ${c.id}: ${ns} is not a design`);
  const seams = [...(s.seams ?? []), ...root.patches.flatMap(({ p }) => (p.ops ?? []).filter((o: any) => o.op === "add" && o.kind === "seam").map((o: any) => o.value))];
  for (const m of seams) {
    for (const ns of m.between) if (!byNs.has(ns)) out.push(`seam ${m.id}: ${ns} is not a design`);
    role(m.owner_role, `seam ${m.id}`);
    for (const c of m.never_cross ?? []) fromRoot(c, "contract", `seam ${m.id} never_cross`);
    for (const [side, parts] of Object.entries<any[]>(m.exposure ?? {})) { if (!m.between.includes(side)) out.push(`seam ${m.id}: exposure side ${side}`); for (const p of parts) fromRoot(typeof p === "string" ? p : p.part, "element", `seam ${m.id} exposure`); }
    for (const x of m.default_exceptions ?? []) { if (!x.accepted_by) out.push(`seam ${m.id}: default exception with no acceptor`); end(x.until, `seam ${m.id} default exception`); for (const c of x.contracts) fromRoot(c, "contract", `seam ${m.id} default exception`); }
  }
  for (const k of Object.keys(s.names ?? {})) fromRoot(k, "element", "names");
  // the org layer
  for (const a of root.org.activities ?? []) {
    team(a.team, `activity ${a.id}`);
    if (a.manual_work && !root.catalog.has(a.manual_work)) out.push(`activity ${a.id}: manual work ${a.manual_work} is not in the catalog`);
    for (const r of a.relieved_by ?? []) { const [ns, id] = split(r.at); if (!byNs.get(ns!)?.ids.unit.has(id) && !byNs.get(ns!)?.ids.phase.has(id)) out.push(`activity ${a.id}: relieved_by ${r.at} is no unit or milestone`); }
  }
  for (const sd of root.org.slowdowns ?? []) {
    if (!root.activities.has(sd.activity)) out.push(`slowdown ${sd.id}: no activity ${sd.activity}`);
    end(sd.until, `slowdown ${sd.id}`);
    for (const r of sd.risk?.refs ?? []) fromRoot(r, "element", `slowdown ${sd.id} risk`);
  }
  for (const [seam, xs] of Object.entries<any[]>(root.org.seam_exceptions ?? {})) {
    const [ns, id] = split(seam);
    if (ns ? !byNs.get(ns)?.ids.seam.has(id) : !seams.some((m) => m.id === id)) out.push(`seam_exceptions: no seam ${seam}`);
    for (const x of xs) { end(x.until, `exception on ${seam}`); for (const c of x.contracts) fromRoot(c, "contract", `exception on ${seam}`); }
  }
  for (const { file, p } of root.patches) for (const op of p.ops ?? []) if (op.op === "modify") {
    const known = op.kind === "team" ? root.teams : op.kind === "activity" ? root.activities : root.shared[op.kind as Kind];
    if (!known?.has(op.id)) out.push(`${file}: modifies ${op.kind} ${op.id}, which does not exist`);
  }

  // each design
  for (const d of designs) {
    const m = d.model, pl = d.plan;
    if (m.teams) out.push(`${d.ns}: declares teams while its root has an org layer`);
    for (const e of m.elements ?? []) {
      team(e.owner, `${d.ns} part ${e.id}`); team(e.verifier, `${d.ns} part ${e.id}`);
      if (e.system) fromDesign(d, e.system, "system", `part ${e.id}`);
      if (e.zone) fromDesign(d, e.zone, "zone", `part ${e.id}`);
      for (const c of e.rests_on ?? []) fromDesign(d, c, "claim", `part ${e.id}`);
    }
    for (const r of m.relationships ?? []) { fromDesign(d, r.from, "element", `relationship ${r.id}`); fromDesign(d, r.to, "element", `relationship ${r.id}`); for (const c of r.carries ?? []) fromDesign(d, c, "contract", `relationship ${r.id}`); }
    for (const c of m.contracts ?? []) for (const e of [...(c.produced_by ?? []), ...(c.consumed_by ?? [])]) fromDesign(d, e, "element", `contract ${c.name}`);
    for (const c of m.claims ?? []) for (const x of c.rests_on ?? []) fromDesign(d, x, "claim", `claim ${c.id}`, true);
    for (const v of m.views ?? []) for (const e of v.elements ?? []) fromDesign(d, e, "element", `view ${v.id}`, true);
    for (const sm of m.seams ?? []) {
      if (sm.between?.[0] !== "core") out.push(`${d.ns} seam ${sm.id}: a module seam is between core and a module`);
      role(sm.owner_role, `${d.ns} seam ${sm.id}`);
      for (const x of sm.crossings ?? []) {
        const rel = (m.relationships ?? []).find((r: any) => r.id === x.id);
        if (!rel) out.push(`${d.ns} seam ${sm.id}: no relationship ${x.id}`);
        else for (const c of x.carries ?? []) if (!(rel.carries ?? []).includes(c)) out.push(`${d.ns} seam ${sm.id}: ${x.id} does not carry ${c}`);
      }
    }
    const provided = new Set((pl.units ?? []).flatMap((u: any) => u.provides ?? []));
    for (const u of pl.units ?? []) {
      if (!d.ids.phase.has(u.phase)) out.push(`${d.ns} unit ${u.id}: no milestone ${u.phase}`);
      team(u.owner, `${d.ns} unit ${u.id}`);
      for (const mv of u.elements ?? []) fromDesign(d, mv.id, "element", `unit ${u.id} moves`);
      for (const c of u.requires ?? []) if (!provided.has(c) && !root.shared.capability.has(c)) out.push(`${d.ns} unit ${u.id}: nothing provides ${c}`);
      for (const c of u.rests_on ?? []) fromDesign(d, c, "claim", `unit ${u.id}`);
      for (const r of u.relieves ?? []) { if (!root.catalog.has(r.manual_work)) out.push(`${d.ns} unit ${u.id}: manual work ${r.manual_work} is not in the catalog`); fromDesign(d, r.rests_on, "claim", `unit ${u.id} relieves`); }
      if (!["feature", "defect", "risk", "debt"].includes(u.flow_item)) out.push(`${d.ns} unit ${u.id}: flow item ${u.flow_item}`);
    }
    for (const id of Object.keys(d.progress?.units ?? {})) if (!d.ids.unit.has(id)) out.push(`${d.ns} progress.yaml: no unit ${id}`);
    for (const [id, r] of Object.entries<any>(d.current?.parts ?? {})) {
      if (r.add) { fromDesign(d, r.add.system, "system", `current ${id}`); team(r.add.owner, `${d.ns} current ${id}`); }
      if (!["new", "retain", "transition", "replace", "retire"].includes(r.disposition)) out.push(`${d.ns} current ${id}: disposition ${r.disposition}`);
      if (r.disposition === "replace") fromDesign(d, r.replaced_by, "element", `current ${id} replaced_by`);
      if (!r.found?.by || !r.found?.as_of) out.push(`${d.ns} current ${id}: found needs by and as_of`);
    }
    for (const pin of d.eng.pins ?? []) if (!byNs.has(pin.namespace) || pin.namespace === d.ns) out.push(`${d.ns}: pins ${pin.namespace}`);
  }
  return out;
}

function portfolio(dir: string): { root: Root; designs: Design[] } {
  const pf = Y(join(dir, "portfolio.yaml"));
  const designs = pf.designs.map((x: any) => { const d = loadDesign(join(dir, x.from)); expect(d.ns).toBe(x.namespace); return d; });
  for (const d of designs) expect(join(d.dir, d.eng.root)).toBe(join(dir, pf.root));
  return { root: loadRoot(join(dir, pf.root)), designs };
}

/** An edition folder whose edition.yaml lists every other file with its sha256, the digest over them and the shared file. */
function editionProblems(dir: string): string[] {
  const e = Y(join(dir, "edition.yaml")), out: string[] = [];
  const files = walk(dir).filter((f) => f !== "edition.yaml").sort(byteOrder);
  expect(e.files.map((f: any) => f.path)).toEqual(files);
  for (const f of e.files) if (sha256(join(dir, f.path)) !== f.sha256) out.push(`${f.path}: sha256 differs`);
  const digest = new Bun.CryptoHasher("sha256").update(e.files.map((f: any) => `${f.sha256}  ${f.path}\n`).join("")).digest("hex");
  if (digest !== e.digest) out.push("digest differs");
  if (e.shared.sha256 !== sha256(join(dir, e.shared.path))) out.push("shared sha256 differs");
  return out;
}

// ── the tests ──────────────────────────────────────────────────────────────────────────────────────────────────

describe("the portfolio fixtures", () => {
  const variants = readdirSync(join(FX, "variants")).sort();

  test("every YAML file parses and writes no key twice", () => {
    const bad: string[] = [];
    for (const dir of [FX, ...(HAVE_EX ? [EX] : [])]) for (const f of walk(dir).filter((x) => x.endsWith(".yaml"))) {
      const text = readFileSync(join(dir, f), "utf8");
      try { Bun.YAML.parse(text); } catch (e) { bad.push(`${relative(DE, join(dir, f))}: ${(e as Error).message}`); }
      for (const k of duplicateKeys(text)) bad.push(`${relative(DE, join(dir, f))} line ${k.line}: ${k.key} twice`);
    }
    expect(bad).toEqual([]);
  });

  test("the base resolves every reference, and every variant names one finding of a new rule", () => {
    const { root, designs } = portfolio(join(FX, "base/portfolio"));
    expect(refProblems(root, designs)).toEqual([]);
    const covered = new Set<string>();
    for (const v of variants) {
      const y = Y(join(FX, "variants", v, "variant.yaml"));
      expect(typeof y.breaks).toBe("string");
      expect(y.expect.length).toBe(1);
      expect(NEW_RULES).toContain(y.expect[0].rule);
      expect(["error", "warning"]).toContain(y.expect[0].severity);
      covered.add(y.expect[0].rule);
      expect(walk(join(FX, "variants", v)).length).toBeGreaterThan(1); // it lays at least one file over the base
    }
    expect(NEW_RULES.filter((r) => !covered.has(r))).toEqual([]);
  });

  test("hashes: the base root, the second root, the frozen beta and alpha's pin are current; file-intact's is not", () => {
    for (const r of ["base/shared", "variants/one-root/shared2"]) expect(Y(join(FX, r, "engine.yaml")).shared_from.sha256).toBe(sha256(join(FX, r, "seams.yaml")));
    const ed = join(FX, "variants/xref-pin-stale/designs/beta/editions/1.0.0");
    expect(editionProblems(ed)).toEqual([]);
    expect(Y(join(FX, "variants/xref-pin-stale/designs/alpha/engine.yaml")).pins[0].sha256).toBe(sha256(join(ed, "edition.yaml")));
    expect(sha256(join(FX, "variants/file-intact/shared/seams.yaml"))).not.toBe(Y(join(FX, "base/shared/engine.yaml")).shared_from.sha256);
  });
});

describe.skipIf(!HAVE_EX)("the example portfolio", () => {
  test("every reference resolves the way the plan says", () => {
    const { root, designs } = portfolio(join(EX, "portfolio"));
    expect(designs.map((d) => d.ns)).toEqual(["intake", "premerge", "inventory"]);
    expect(refProblems(root, designs)).toEqual([]);
  });

  test("hashes: the root's shared_from, premerge's frozen 1.0.0 and intake's pin are current", () => {
    expect(Y(join(EX, "shared/engine.yaml")).shared_from.sha256).toBe(sha256(join(EX, "shared/seams.yaml")));
    const ed = join(EX, "designs/premerge/editions/1.0.0");
    expect(editionProblems(ed)).toEqual([]);
    expect(Y(join(EX, "designs/intake/engine.yaml")).pins).toEqual([{ namespace: "premerge", version: "1.0.0", sha256: sha256(join(ed, "edition.yaml")) }]);
    // 1.0.0 was checked with the shared file the root holds now, and differs from the working copy in one place
    expect(readFileSync(join(ed, "seams.yaml"), "utf8")).toBe(readFileSync(join(EX, "shared/seams.yaml"), "utf8"));
    const [now, then] = [Y(join(EX, "designs/premerge/model.yaml")), Y(join(ed, "model.yaml"))];
    const runner = (m: any) => m.elements.find((e: any) => e.id === "check-runner");
    expect([runner(then).workspace, runner(now).workspace]).toEqual(["per-repository", "per-run"]);
    delete runner(now).workspace; delete runner(then).workspace;
    expect(now).toEqual(then);
  });

  test("the tracker export is exactly what its generator writes", () => {
    const out = mkdtempSync(join(tmpdir(), "plumb-jira-export-"));
    const r = Bun.spawnSync(["bun", join(FX, "make-jira-export.ts"), out], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const here = join(EX, "shared/tracker/export");
    expect(walk(out).sort()).toEqual(walk(here).sort());
    for (const f of walk(here)) expect(readFileSync(join(out, f), "utf8")).toBe(readFileSync(join(here, f), "utf8"));
  });

  test("the README lists the findings expected.yaml holds, and every variant with its rule", () => {
    const readme = readFileSync(join(EX, "README.md"), "utf8");
    /** The body rows of the first table after a heading, as trimmed cells. */
    const firstTable = (heading: string): string[][] => {
      const at = readme.indexOf(heading);
      expect(at).toBeGreaterThan(-1);
      const lines = readme.slice(at).split("\n");
      const start = lines.findIndex((l) => l.startsWith("|"));
      const rows: string[][] = [];
      for (const l of lines.slice(start + 2)) { if (!l.startsWith("|")) break; rows.push(l.split("|").slice(1, -1).map((c) => c.trim())); }
      return rows;
    };
    const exp = Y(join(EX, "expected.yaml"));
    const findings = firstTable("## The findings, all together");
    expect(findings.map((r) => [r[0], r[1]])).toEqual(exp.findings.map((f: any) => [f.rule, f.severity]));
    const listed = firstTable("## Broken variants").map((r) => [r[0], r[2], r[3]]).sort();
    const actual = readdirSync(join(FX, "variants")).sort().map((v) => { const y = Y(join(FX, "variants", v, "variant.yaml")); return [v, y.expect[0].rule, y.expect[0].severity]; });
    expect(listed).toEqual(actual);
  });
});
