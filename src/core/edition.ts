import { parseYaml } from "./yaml.ts";
import { invocation } from "./invocation.ts";
// Editions: released and latest, exact pins and the pin checks.
//
// A released edition is a folder <instance>/editions/<version>/ holding the frozen design (engine.yaml, model.yaml,
// plan.yaml, the accepted patches under patches/), a frozen copy of the root's shared file when the design has a
// root, and edition.yaml. `plumb release` writes one for a local design; the importer copies a shipped one in. Live
// state is never frozen and stays in the instance folder: progress.yaml, milestones.yaml, notes.yaml, proposed
// patches, tracker/, reports/, current.yaml, deck.yaml and tour.yaml. Building an edition means its frozen design
// plus the instance's live state now (src/core/load.ts, `loadInstance(dir, { edition })`); `latest` is the working
// copy.
//
// edition.yaml, as released designs and `plumb release` writes it:
//   line, namespace, version, released (a boolean), date ("YYYY-MM-DD"), build (a short commit, "+local" when the
//   inputs differ from it; outside git, the model hash's first 12 hex), schema: { model?, design_engine: "0.4" },
//   files: [{ path, sha256 }] (every file in the folder but edition.yaml, by path in byte order), digest (SHA-256
//   over "<sha256>  <path>\n" per file, in that order), pins: [{ namespace, version, sha256, tag? }],
//   shared: { path, sha256, namespace?, version? }, manual_work: { path, sha256 } or null.
// Keys the engine does not read are carried through. A pin names an edition by the SHA-256 of its edition.yaml bytes,
// in full or by a prefix of 12 or more hex characters, so a changed file under an old version is caught.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ComposedDesign, EditionFile, EditionRef, EditionStamp, Finding, Instance, Model, Pin, Plan, RootInput } from "../types.ts";
import { fileSha256, loadShared } from "./root.ts";
import { cmpVersion } from "./schema.ts";
import { natCompare } from "./util.ts";
import { DIGEST } from "./digest.ts";
import { parseRef, SHARED } from "./namespace.ts";

export const EDITIONS = "editions";
/** The design inputs a release freezes; patches/ adds the accepted patches. */
export const DESIGN_FILES = ["engine.yaml", "model.yaml", "plan.yaml"];
export const LABEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** A pin read from engine.yaml or edition.yaml; undefined with the problem when it is not exact. */
export function normPin(v: unknown): { pin?: Pin; problem?: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { problem: `a pin is a mapping { namespace, version, sha256 }, not ${JSON.stringify(v)}` };
  const r = v as Raw;
  const pin: Pin = { namespace: str(r.namespace) ?? "", version: str(r.version) ?? "", sha256: (str(r.sha256) ?? "").toLowerCase() };
  if (r.tag != null) pin.tag = String(r.tag);
  const miss = (["namespace", "version", "sha256"] as const).filter((k) => !pin[k]);
  if (miss.length) return { pin, problem: `the pin of ${pin.namespace || "an edition"} has no ${miss.join(" or ")}, so it is not exact` };
  if (!/^[0-9a-f]{12,64}$/.test(pin.sha256)) return { pin, problem: `the pin of ${pin.namespace} ${pin.version} has sha256 "${pin.sha256}", which is not 12 to 64 hex characters of an edition.yaml hash` };
  return { pin };
}

/** Does a pin's hash name this edition.yaml hash (the full hash, or a prefix of 12 or more)? */
export const pinMatches = (pin: Pin, sha256: string): boolean => pin.sha256.length >= 12 && sha256.toLowerCase().startsWith(pin.sha256.toLowerCase());

/** The digest over a files list: SHA-256 of "<sha256>  <path>\n" per file, in the list's order (as sha256sum prints it). */
export function filesDigest(files: EditionFile[]): string {
  return new Bun.CryptoHasher("sha256").update(files.map((f) => `${f.sha256}  ${f.path}\n`).join("")).digest("hex");
}

/** Every file under a folder, relative, sorted by path in byte order; edition.yaml at its top is left out. */
export function editionFiles(dir: string): EditionFile[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p)); } };
  walk(dir);
  return out.filter((p) => p !== "edition.yaml").sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)))).map((path) => ({ path, sha256: fileSha256(join(dir, path))! }));
}

/** Read edition.yaml's fields; anything the engine does not read is kept. */
export function normStamp(raw: unknown): EditionStamp {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Raw;
  const pins = (Array.isArray(r.pins) ? r.pins : []).map((p) => normPin(p).pin).filter((p): p is Pin => !!p);
  const ref = (v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const x = v as Raw, path = str(x.path) ?? str(x.file);
    return path && x.sha256 ? { ...x, path, sha256: String(x.sha256) } as { path: string; sha256: string } : undefined;
  };
  const files = (Array.isArray(r.files) ? r.files : []).flatMap((f) => { const x = ref(f); return x ? [{ path: x.path, sha256: x.sha256 }] : []; });
  const stamp: EditionStamp = { ...r, version: str(r.version) ?? "", files, pins };
  if (r.date != null) stamp.date = str(r.date);
  const sh = ref(r.shared); if (sh) stamp.shared = sh; else delete stamp.shared;
  if (r.manual_work === null) stamp.manual_work = null; else { const mw = ref(r.manual_work); if (mw) stamp.manual_work = mw; else delete stamp.manual_work; }
  return stamp;
}

/** The released editions of an instance, oldest first (versions compared as numbers where they are versions). */
export function listEditions(instanceDir: string): string[] {
  const d = join(instanceDir, EDITIONS);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((v) => existsSync(join(d, v, "edition.yaml"))).sort((a, b) => cmpVersion(a.replace(/[^0-9.].*$/, ""), b.replace(/[^0-9.].*$/, "")) || natCompare(a, b));
}

/** Read <instance>/editions/<version>/. Throws when there is no such released edition. */
export function readEdition(instanceDir: string, version: string): EditionRef {
  const dir = join(resolve(instanceDir), EDITIONS, version);
  const file = join(dir, "edition.yaml");
  if (!existsSync(file)) {
    const have = listEditions(instanceDir);
    throw new Error(`${relative(process.cwd(), instanceDir)} has no released edition ${version} (no ${relative(process.cwd(), file)}); ${have.length ? `released: ${have.join(", ")}` : `it has released none (${invocation()} release)`}`);
  }
  let raw: unknown;
  try { raw = parseYaml(readFileSync(file, "utf8")); } catch (e) { throw new Error(`editions/${version}/edition.yaml: YAML parse error: ${(e as Error).message}`); }
  return { version, dir, sha256: fileSha256(file)!, stamp: normStamp(raw) };
}

/** The newest released edition, or undefined. */
export function newestEdition(instanceDir: string): EditionRef | undefined {
  const all = listEditions(instanceDir);
  return all.length ? readEdition(instanceDir, all[all.length - 1]) : undefined;
}

/** Do the edition's files still have the hashes edition.yaml lists, and does its digest hold? The problems, in words. */
export function verifyEdition(ed: EditionRef): string[] {
  const out: string[] = [];
  for (const f of ed.stamp.files) {
    const sha = fileSha256(join(ed.dir, f.path));
    if (!sha) out.push(`${f.path} is listed but not there`);
    else if (sha !== f.sha256) out.push(`${f.path} has changed since the release (sha256 ${sha.slice(0, 12)}, listed ${f.sha256.slice(0, 12)})`);
  }
  if (typeof ed.stamp.digest === "string" && ed.stamp.digest !== filesDigest(ed.stamp.files)) out.push("the digest does not match the files list");
  // Imported adapters do not replace any published file. Their sidecar checks the conversion independently,
  // bound to the original stamp, so an ordinary hand edit cannot bypass release integrity through an adapter.
  const adapter = join(ed.dir, "engine-import.yaml");
  if (existsSync(adapter)) {
    try {
      const raw = parseYaml(readFileSync(adapter, "utf8"),adapter) as any;
      if (raw?.source_sha256 !== ed.sha256) out.push("the engine adapter names a different edition stamp");
      if (raw.adapters && (typeof raw.adapters !== "object" || Array.isArray(raw.adapters) || Object.keys(raw.adapters).sort().join(",") !== "engine,model,plan")) out.push("the engine adapter paths are invalid");
      const paths = raw.adapters ? Object.values(raw.adapters) : ["engine.yaml", "model.engine.yaml", "plan.engine.yaml"];
      const pathKey = (path: string) => path.normalize("NFC").toLowerCase();
      if (paths.length !== 3 || new Set(paths.map(path => typeof path === "string" ? pathKey(path) : path)).size !== 3) out.push("the engine adapter paths are invalid");
      for (const path of paths) {
        if (typeof path !== "string" || /[\\:\x00-\x1f]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..") || ed.stamp.files.some(f => pathKey(f.path) === pathKey(path))) { out.push("the engine adapter uses an invalid or published path"); continue; }
        const hash = raw?.files?.find((f: any) => f.path === path)?.sha256;
        if (!hash || fileSha256(join(ed.dir, path)) !== hash) out.push(`${path} has changed since import; reimport the verified editions`);
      }
    } catch { out.push("engine-import.yaml does not parse; reimport the verified editions"); }
  } else if (existsSync(join(ed.dir, "model.engine.yaml"))) out.push("the imported engine adapters have no integrity sidecar; reimport the verified editions");
  return out;
}

/** Imported edition adapters may use alternate names when a published input occupies a conventional name. */
export function readAdapterPaths(ed: EditionRef): { engine: string; model: string; plan: string } | undefined {
  const sidecar = join(ed.dir,"engine-import.yaml");
  if (!existsSync(sidecar)) return undefined;
  const raw = parseYaml(readFileSync(sidecar,"utf8"),sidecar) as any;
  return raw.adapters ?? { engine: "engine.yaml", model: "model.engine.yaml", plan: "plan.engine.yaml" };
}

// ---------- release ----------

const q = (s: string) => JSON.stringify(s);

/** edition.yaml as text, in the published field order. */
export function stampYaml(s: EditionStamp): string {
  const lines: string[] = ["# Written by bun plumb.ts release. The engine pins this edition by the sha256 of this file."];
  if (s.line) lines.push(`line: ${s.line}`);
  if (s.namespace) lines.push(`namespace: ${s.namespace}`);
  lines.push(`version: ${q(s.version)}`, `released: ${s.released === false ? "false" : "true"}`);
  if (s.date) lines.push(`date: ${q(s.date)}`);
  if (s.build) lines.push(`build: ${q(s.build)}`);
  if (s.schema) lines.push(`schema: { ${Object.entries(s.schema).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${typeof v === "number" ? v : q(String(v))}`).join(", ")} }`);
  lines.push(s.files.length ? "files:" : "files: []", ...s.files.map((f) => `  - { path: ${q(f.path)}, sha256: ${f.sha256} }`));
  if (s.digest) lines.push(`digest: ${s.digest}`);
  lines.push(s.pins.length ? "pins:" : "pins: []", ...s.pins.map((p) => `  - { namespace: ${p.namespace}, version: ${q(p.version)}, ${p.tag ? `tag: ${q(p.tag)}, ` : ""}sha256: ${p.sha256} }`));
  if (s.shared) lines.push(`shared: { path: ${q(s.shared.path)}, sha256: ${s.shared.sha256} }`);
  if (s.manual_work) lines.push(`manual_work: { path: ${q(s.manual_work.path)}, sha256: ${s.manual_work.sha256} }`);
  return lines.join("\n") + "\n";
}

function git(dir: string, args: string[]): string | undefined {
  try {
    const p = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : undefined;
  } catch { return undefined; }
}

/** The build stamp: the git short commit of the instance folder, "+local" when the folder has uncommitted changes; else the fallback. */
export function buildStamp(dir: string, fallback: string): string {
  const commit = git(dir, ["rev-parse", "--short=12", "HEAD"]);
  if (!commit) return fallback;
  const dirty = git(dir, ["status", "--porcelain", "--", "."]);
  return dirty ? `${commit}+local` : commit;
}

/** Today in the local time zone, YYYY-MM-DD. */
export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ReleaseResult { dir: string; version: string; sha256: string; stamp: EditionStamp; text: string }

/**
 * Freeze the instance's design as a released edition: copy the design inputs and the accepted patches, the root's
 * shared file (and the manual-work catalog) when the design has a root, and write edition.yaml. Refuses a label that
 * exists. `inst` is the instance as loaded (its patches carry their status); `modelHash` stamps the build outside git.
 */
export function release(inst: Instance, label: string, modelHash: string, opts: { date?: string; build?: string } = {}): ReleaseResult {
  if (!LABEL.test(label)) throw new Error(`--label "${label}" is not a folder name: use letters, digits, dots, hyphens and plus signs, such as 1.0.0`);
  if (inst.edition) throw new Error(`release freezes the working copy, not a released edition`);
  const dir = join(inst.dir, EDITIONS, label);
  if (existsSync(dir)) throw new Error(`${relative(process.cwd(), dir) || dir} exists: the label ${label} is released already, and a release is never rewritten`);
  mkdirSync(dir, { recursive: true });
  for (const f of DESIGN_FILES) if (existsSync(join(inst.dir, f))) cpSync(join(inst.dir, f), join(dir, f));
  for (const p of inst.patches) if (p.status === "accepted" && p.file) { mkdirSync(dirname(join(dir, p.file)), { recursive: true }); cpSync(join(inst.dir, p.file), join(dir, p.file)); }
  const root = inst.ns?.root?.input;
  let shared: EditionStamp["shared"], manual: EditionStamp["manual_work"];
  if (root?.shared) {
    cpSync(join(root.dir, root.shared.file), join(dir, "seams.yaml"));
    shared = { path: "seams.yaml", sha256: root.shared.sha256 };
    if (root.shared.manualWorkFile) { cpSync(join(root.dir, root.shared.manualWorkFile.file), join(dir, "manual-work.yaml")); manual = { path: "manual-work.yaml", sha256: root.shared.manualWorkFile.sha256 }; }
  }
  const files = editionFiles(dir);
  const ns = inst.ns?.namespace;
  const stamp: EditionStamp = {
    line: ns ?? inst.config.name, ...(ns ? { namespace: ns } : {}), version: label, released: true,
    date: opts.date ?? today(), build: opts.build ?? buildStamp(inst.dir, modelHash.slice(0, 12)),
    schema: { design_engine: "0.4" }, files, digest: filesDigest(files), pins: inst.ns?.pins ?? [],
    ...(shared ? { shared } : {}), ...(manual ? { manual_work: manual } : {}),
  };
  const text = stampYaml(stamp);
  writeFileSync(join(dir, "edition.yaml"), text);
  return { dir, version: label, sha256: fileSha256(join(dir, "edition.yaml"))!, stamp, text };
}

// ---------- the pin checks (core/xref-pin-stale) ----------

const stale = (at: string, message: string): Finding => ({ pack: "core", rule: "xref-pin-stale", severity: "warning", at, atKind: "instance", message });
/** What the records named came to: "none of the 3 <many> changed" or "the one <one> did not change"; "of the 3 <many>, ...". */
const ofThe = (n: number, one: string, many: string) => (n === 1 ? `of the one ${one}` : `of the ${n} ${many}`);
const short = (h: string) => h.slice(0, 12);

/** A record's hash without its wording and owners (src/site/client/digest.js), so a reworded record is not stale. */
const bareOf = (kind: string, rec: unknown) => DIGEST.recordDigest(kind, rec).bare;

/** The records of design `ns` the shared layer names: crossing ends, exposure entries, providers of the capabilities it provides. */
export function namedByShared(root: RootInput | undefined, ns: string, plan?: Plan): { kind: "element" | "unit"; id: string }[] {
  const out = new Map<string, { kind: "element" | "unit"; id: string }>();
  const sh = root?.shared;
  const part = (ref: string) => { const r = parseRef(ref); if (r.ns === ns) out.set(`element:${r.id}`, { kind: "element", id: r.id }); };
  for (const x of sh?.crossings ?? []) { part(x.from); part(x.to); }
  for (const sm of sh?.seams ?? []) for (const es of Object.values(sm.exposure ?? {})) for (const e of es) part(e.part);
  const caps = new Set((sh?.capabilities ?? []).filter((c) => c.provided_by.includes(ns)).map((c) => c.id));
  for (const u of plan?.units ?? []) if ((u.provides ?? []).some((c) => caps.has(c) || caps.has(parseRef(c).id))) out.set(`unit:${u.id}`, { kind: "unit", id: u.id });
  return [...out.values()].sort((a, b) => natCompare(a.kind, b.kind) || natCompare(a.id, b.id));
}

/** How a design's records compare between two of its compiled states, for the records named. */
function changedRecords(named: { kind: "element" | "unit"; id: string }[], a: { model: Model; plan: Plan }, b: { model: Model; plan: Plan }): { gone: string[]; changed: string[] } {
  const get = (s: { model: Model; plan: Plan }, kind: string, id: string) => (kind === "element" ? s.model.elements.find((e) => e.id === id) : s.plan.units.find((u) => u.id === id));
  const gone: string[] = [], changed: string[] = [];
  for (const n of named) {
    const x = get(a, n.kind, n.id), y = get(b, n.kind, n.id);
    const name = (y as { name?: string; title?: string } | undefined)?.name ?? (y as { title?: string } | undefined)?.title ?? (x as { name?: string; title?: string } | undefined)?.name ?? (x as { title?: string } | undefined)?.title ?? n.id;
    if (!x) continue;                                            // not there when pinned: nothing the pin promised
    if (!y) gone.push(`${name} (${n.id}), gone`);
    else if (bareOf(n.kind, x) !== bareOf(n.kind, y)) changed.push(`${name} (${n.id})`);
  }
  return { gone, changed };
}

/**
 * (i) A design pins another design's edition and the build composes a different edition of it (its working copy
 * included), or the edition under that version has another hash. One finding per pin, listing the pinned design's
 * records that the shared layer names and that are gone or changed apart from their wording, only when at least one changed.
 * `load` compiles a design folder as written, at a released edition or (undefined) its working copy.
 */
export function pinStaleFinding(own: string, pin: Pin, d: ComposedDesign, root: RootInput | undefined, load: (dir: string, edition?: string) => { model: Model; plan: Plan }): Finding | undefined {
  const at = `pin ${pin.namespace} ${pin.version}`;
  let pinned: EditionRef;
  try { pinned = readEdition(d.dir, pin.version); }
  catch { return stale(at, `${own} pins ${d.title} ${pin.version}, which ${d.title} (${pin.namespace}) has not released: there is no editions/${pin.version}/edition.yaml in its folder`); }
  if (!pinMatches(pin, pinned.sha256))
    return stale(at, `${own} pins ${d.title} ${pin.version} at sha256 ${short(pin.sha256)}, and the edition under that version now has ${short(pinned.sha256)}: a file under a released version changed`);
  // edition.yaml lists every frozen file with its hash, so a file changed beside an unchanged edition.yaml is caught too
  const changedFiles = verifyEdition(pinned);
  if (changedFiles.length) return stale(at, `${own} pins ${d.title} ${pin.version}, and under that version ${changedFiles.join("; ")}`);
  if (d.edition === pin.version && (!d.editionSha256 || pinMatches(pin, d.editionSha256))) return undefined;
  const composedAs = d.edition ? `${d.title} ${d.edition}` : `the working copy of ${d.title}`;
  const named = namedByShared(root, pin.namespace, d.plan);
  let diff: { gone: string[]; changed: string[] } = { gone: [], changed: [] };
  try { diff = changedRecords(named, load(d.dir, pin.version), load(d.dir, d.edition)); }
  catch (e) { return stale(at, `${own} pins ${d.title} ${pin.version}, and this build composes ${composedAs}; the pinned edition could not be read to compare (${(e as Error).message})`); }
  const what = [...diff.changed.map((x) => `${x}, changed`), ...diff.gone];
  if (!what.length) return undefined;
  const one = `record of ${d.title} the shared layer names`, many = `records of ${d.title} the shared layer names`;
  return stale(at, `${own} pins ${d.title} ${pin.version}, and this build composes ${composedAs}: ${ofThe(named.length, one, many)}, ${what.join("; ")}`);
}

/**
 * (ii) The design's edition recorded a shared-file hash, and the root's shipped file has another. One finding,
 * listing the shared records the design names that changed apart from their wording or are gone, from the frozen copy
 * beside edition.yaml. The organization's patches on the shared layer are not staleness: this compares the shipped file.
 */
export function sharedStaleFinding(ed: EditionRef | undefined, root: RootInput | undefined, named: { kind: string; id: string }[]): Finding | undefined {
  const rec = ed?.stamp.shared;
  if (!ed || !rec || !root?.shared || pinMatches({ namespace: SHARED, version: "", sha256: rec.sha256 }, root.shared.sha256)) return undefined;
  const at = "seams.yaml";
  const head = `edition ${ed.version} was checked with the shared file at sha256 ${short(rec.sha256)}, and the root's shipped seams.yaml is now ${short(root.shared.sha256)}`;
  const copy = join(ed.dir, rec.path);
  if (!existsSync(copy) || fileSha256(copy) !== rec.sha256) return stale(at, `${head}; the edition folder holds no copy of the old file to compare`);
  const old = loadShared(dirname(copy));
  const pick = (layer: NonNullable<RootInput["shared"]>, kind: string, id: string): unknown => {
    switch (kind) {
      case "element": return layer.parts.find((x) => x.id === id);
      case "relationship": return layer.crossings.find((x) => x.id === id);
      case "contract": return layer.contracts.find((x) => x.name === id);
      case "system": return layer.systems.find((x) => x.id === id);
      case "zone": return layer.zones.find((x) => x.id === id);
      case "claim": return layer.claims.find((x) => x.id === id);
      case "capability": return layer.capabilities.find((x) => x.id === id);
      case "seam": return layer.seams.find((x) => x.id === id);
      default: return undefined;
    }
  };
  const changed: string[] = [];
  for (const n of named) {
    const a = old ? pick(old, n.kind, n.id) : undefined, b = pick(root.shipped ?? root.shared, n.kind, n.id); // the shipped file, never the organization's patches
    if (!a && !b) continue;
    if (!b) changed.push(`${n.kind} shared:${n.id}, gone`);
    else if (!a) changed.push(`${n.kind} shared:${n.id}, new`);
    else if (bareOf(n.kind, a) !== bareOf(n.kind, b)) changed.push(`${n.kind} shared:${n.id}, changed`);
  }
  if (!changed.length) return undefined;
  const one = "shared record this design names", many = "shared records this design names";
  return stale(at, `${head}: ${ofThe(named.length, one, many)}, ${changed.join("; ")}`);
}

// ---------- the import graph (core/xref-no-cycle) ----------

const noCycle = (at: string, message: string): Finding => ({ pack: "core", rule: "xref-no-cycle", severity: "error", at, atKind: "instance", message });

/** Pin loops among designs: every strongly connected group of two or more, or a design that pins itself, named as a loop. */
export function pinLoops(designs: { namespace: string; pins: Pin[] }[]): string[][] {
  const by = new Map(designs.map((d) => [d.namespace, d]));
  const loops: string[][] = [];
  const seen = new Set<string>();
  for (const start of [...by.keys()].sort(natCompare)) {
    // depth-first from each design along pins, reporting each loop once by its smallest member
    const stack: string[] = [];
    const visit = (n: string) => {
      const i = stack.indexOf(n);
      if (i >= 0) {
        const cyc = stack.slice(i);
        const key = [...cyc].sort(natCompare).join(" ");
        if (!seen.has(key)) { seen.add(key); const k = cyc.indexOf([...cyc].sort(natCompare)[0]); loops.push([...cyc.slice(k), ...cyc.slice(0, k)]); }
        return;
      }
      if (stack.length > by.size) return;
      stack.push(n);
      for (const p of by.get(n)?.pins ?? []) if (by.has(p.namespace)) visit(p.namespace);
      stack.pop();
    };
    visit(start);
  }
  return loops;
}

/** The loop as words: "intake pins premerge, which pins intake". */
export const loopText = (cyc: string[]): string =>
  cyc.length === 1 ? `${cyc[0]} pins itself` : [`${cyc[0]} pins ${cyc[1]}`, ...cyc.slice(2).map((n) => `which pins ${n}`), `which pins ${cyc[0]}`].join(", ");

export { noCycle };
