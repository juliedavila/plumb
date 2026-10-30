// Helpers for seam tests: block YAML for fixtures a test writes, and the split parity fixture.
import { join } from "node:path";
import { SHARED } from "../src/core/namespace.ts";
import { natCompare } from "../src/core/util.ts";

/** A value as block YAML (strings double-quoted), for fixtures a test writes: the engine's duplicate-key scan reads block style quickly. */
export function toYaml(v: unknown, indent = ""): string {
  const key = (k: string) => (/^[A-Za-z0-9_.-]+$/.test(k) ? k : JSON.stringify(k));
  const scalar = (x: unknown) => (typeof x === "string" ? JSON.stringify(x) : x === null || x === undefined ? "null" : String(x));
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return v.map((x) => {
      if (x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length) {
        const body = toYaml(x, `${indent}  `);
        return `\n${indent}- ${body.trimStart()}`;
      }
      return `\n${indent}- ${x && typeof x === "object" ? toYaml(x, `${indent}  `) : scalar(x)}`;
    }).join("");
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return "{}";
    return entries.map(([k, x]) => {
      if (x && typeof x === "object") { const body = toYaml(x, `${indent}  `); return `\n${indent}${key(k)}:${body.startsWith("\n") ? body : ` ${body}`}`; }
      return `\n${indent}${key(k)}: ${scalar(x)}`;
    }).join("");
  }
  return scalar(v);
}

// ---------- the split parity fixture ----------

/**
 * A compiled single-design model split at a module boundary into two designs over a shared root, written to a
 * temporary folder: the parts tagged `module: <module>` become design `inner`, the rest design `outer`; every
 * relationship between the two sides moves into the shared layer as a crossing, with every contract that spans both
 * sides; systems and zones become shared vocabulary; each side keeps every team. The seam's exposure tells the outer
 * side's own build which of the inner parts at its edge coding agents reach (when `exposeOuter`). Claims and the plan
 * stay out: the parity is the security pack's. `rename` maps each id of the single model to its composed id.
 */
export function splitAtModule(model: import("../src/types.ts").Model, module: string, names: { outer: string; inner: string; outerTitle: string; innerTitle: string }, opts: { exposeOuter?: boolean } = {}) {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const m = structuredClone(model);
  const inner = new Set(m.elements.filter((e) => e.attrs?.module === module).map((e) => e.id));
  const side = (id: string) => (inner.has(id) ? names.inner : names.outer);
  const crossing = m.relationships.filter((r) => side(r.from) !== side(r.to));
  const xids = new Set(crossing.map((r) => r.id));
  const sidesOf = (name: string) => {
    const s = new Set<string>();
    const c = m.contracts.find((x) => x.name === name)!;
    for (const e of [...(c.produced_by ?? []), ...(c.consumed_by ?? [])]) s.add(side(e));
    for (const r of m.relationships) if ((r.carries ?? []).includes(name)) { s.add(side(r.from)); s.add(side(r.to)); }
    return s;
  };
  const sharedC = new Set(crossing.flatMap((r) => r.carries ?? []));
  for (const c of m.contracts) if (sidesOf(c.name).size > 1) sharedC.add(c.name);
  const ownerOf = (name: string) => (sharedC.has(name) ? SHARED : [...sidesOf(name)][0] ?? names.outer);
  const q = (id: string) => `${side(id)}:${id}`;
  const strip = <T extends object>(x: T) => { const o = { ...x } as Record<string, unknown>; delete o.rests_on; return o; };
  const ends = new Set(crossing.flatMap((r) => [r.from, r.to]));
  const reach = (id: string) => m.elements.find((x) => x.id === id)?.attrs?.agent_reachable === true;
  const shared = {
    namespace: SHARED, version: "1.0.0", schema: { model: 5, design_engine: "0.4" },
    systems: m.systems, zones: m.zones,
    contracts: m.contracts.filter((c) => sharedC.has(c.name)).map((c) => ({ ...c, produced_by: c.produced_by?.map(q), consumed_by: c.consumed_by?.map(q) })),
    crossings: crossing.map((r) => ({ ...strip(r), from: q(r.from), to: q(r.to) })),
    seams: [{ id: module, between: [names.outer, names.inner], owner_role: "the module's owner",
      exposure: { [names.outer]: opts.exposeOuter === false ? [] : [...ends].filter((e) => side(e) === names.inner && reach(e)).sort(natCompare).map(q), [names.inner]: [] } }],
    names: Object.fromEntries([...ends].sort(natCompare).map((e) => [q(e), m.elements.find((x) => x.id === e)!.name])),
  };
  const d = mkdtempSync(join(tmpdir(), "plumb-split-"));
  const w = (p: string, v: unknown) => { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), toYaml(v).trimStart() + "\n"); };
  w("shared/engine.yaml", { kind: "root", name: "split-root", title: "Split root", schema: "0.4" });
  w("shared/seams.yaml", shared);
  for (const [ns, title] of [[names.outer, names.outerTitle], [names.inner, names.innerTitle]]) {
    w(`${ns}/engine.yaml`, { name: ns, title, schema: "0.4", namespace: ns, root: "../shared", packs: ["security"] });
    w(`${ns}/model.yaml`, {
      teams: m.teams,
      elements: m.elements.filter((e) => side(e.id) === ns).map(strip),
      relationships: m.relationships.filter((r) => !xids.has(r.id) && side(r.from) === ns).map(strip),
      contracts: m.contracts.filter((c) => !sharedC.has(c.name) && ownerOf(c.name) === ns),
      views: [{ id: "edge", title: "A few parts", elements: m.elements.filter((e) => side(e.id) === ns).slice(0, 8).map((e) => e.id) }], // one small view, so no view of every part is laid out
    });
  }
  w("portfolio/portfolio.yaml", { schema: "0.4", name: "split", title: `${names.outerTitle} split at its module boundary`, root: "../shared",
    designs: [{ namespace: names.outer, from: `../${names.outer}` }, { namespace: names.inner, from: `../${names.inner}` }] });
  const rename = new Map<string, string>();
  for (const e of m.elements) rename.set(e.id, q(e.id));
  for (const r of m.relationships) rename.set(r.id, xids.has(r.id) ? `${SHARED}:${r.id}` : `${side(r.from)}:${r.id}`);
  for (const c of m.contracts) rename.set(c.name, `${ownerOf(c.name)}:${c.name}`);
  return { dir: d, rename, crossings: crossing.map((r) => r.id), sharedContracts: [...sharedC].sort(natCompare), innerParts: inner.size };
}

/** A message from the single model with its ids renamed to the composed ones. */
export const renameIds = (s: string, rename: Map<string, string>) => s.replace(/[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9_]/g, (t) => rename.get(t) ?? t);
