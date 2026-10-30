// Writes the hashes the example portfolio and its test fixtures carry, so a hand edit to a shared file or a design
// does not leave them stale:
//   - a root's engine.yaml shared_from.sha256: the sha256 of its seams.yaml (shared/file-intact compares the two)
//   - a released edition, frozen from the design's working files: its frozen copies, and edition.yaml in the shape
//     `bun plumb.ts release` writes: every frozen file but edition.yaml with its sha256, the digest over them
//     (sha256 of "<sha256>  <path>\n" lines in byte order of path), and the shared files it was checked with
//   - the pin on that edition in the pinning design's engine.yaml: the sha256 of the edition's edition.yaml
// It never touches a variant meant to break a hash (tests/fixtures/portfolio/variants/file-intact keeps its own).
//
// Run from the plumb folder: bun tests/fixtures/portfolio/rehash.ts   (idempotent: a second run changes nothing)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const DE = join(HERE, "../../..");
const sha256 = (s: string | Buffer) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const read = (p: string) => readFileSync(p, "utf8");
let changed = 0;
const write = (p: string, s: string) => { if (!existsSync(p) || read(p) !== s) { writeFileSync(p, s); changed++; console.log(`wrote ${p.slice(DE.length + 1)}`); } };

/** A root's shared_from.sha256 := sha256(seams.yaml). */
function rehashRoot(root: string) {
  const eng = join(root, "engine.yaml");
  const h = sha256(readFileSync(join(root, "seams.yaml")));
  const text = read(eng), next = text.replace(/(\nshared_from:\n(?:[ \t].*\n)*?[ \t]+sha256: )\S+/, `$1${h}`);
  if (next === text && !text.includes(h)) throw new Error(`${eng}: no shared_from.sha256 line to rewrite`);
  write(eng, next);
}

interface Edition {
  /** The design whose working files are frozen, and where the edition goes (default: <design>/editions/<version>). */
  design: string; out?: string; root: string; version: string; date: string; build: string;
  /** What the released copy said where the working copy differs now. */
  model?: (text: string) => string;
}
/** Freeze an edition from the design's working files (with the recorded difference) and the root's shared files. */
function freeze(e: Edition): string {
  const dir = e.out ?? join(e.design, "editions", e.version);
  mkdirSync(dir, { recursive: true });
  for (const f of ["engine.yaml", "plan.yaml"]) write(join(dir, f), read(join(e.design, f)));
  const model = read(join(e.design, "model.yaml"));
  write(join(dir, "model.yaml"), e.model ? e.model(model) : model);
  const pdir = join(e.design, "patches");
  if (existsSync(pdir)) for (const f of readdirSync(pdir).filter((x) => /\.ya?ml$/.test(x))) {
    const t = read(join(pdir, f));
    if (/^status:\s*accepted\s*$/mi.test(t)) { mkdirSync(join(dir, "patches"), { recursive: true }); write(join(dir, "patches", f), t); }
  }
  for (const f of ["seams.yaml", "manual-work.yaml"]) if (existsSync(join(e.root, f))) write(join(dir, f), read(join(e.root, f)));
  const files = walk(dir).filter((p) => p !== "edition.yaml").sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((p) => ({ path: p, sha256: sha256(readFileSync(join(dir, p))) }));
  const digest = sha256(files.map((f) => `${f.sha256}  ${f.path}\n`).join(""));
  const ns = /^namespace:\s*(\S+)/m.exec(read(join(e.design, "engine.yaml")))![1];
  const hashOf = (p: string) => files.find((f) => f.path === p)?.sha256;
  const seamsVersion = /^version:\s*"?([^"\n]+)"?/m.exec(read(join(dir, "seams.yaml")))?.[1];
  const y = [
    "# Written by tests/fixtures/portfolio/rehash.ts in the shape bun plumb.ts release writes: every frozen file but this",
    "# one with its sha256, the digest over them, and the shared files this edition was checked with.",
    `line: ${ns}`,
    `namespace: ${ns}`,
    `version: "${e.version}"`,
    "released: true",
    `date: "${e.date}"`,
    `build: ${e.build}`,
    'schema: { design_engine: "0.4" }',
    "pins: []",
    `shared: { namespace: shared, version: "${seamsVersion}", path: seams.yaml, sha256: ${hashOf("seams.yaml")} }`,
    hashOf("manual-work.yaml") ? `manual_work: { path: manual-work.yaml, sha256: ${hashOf("manual-work.yaml")} }` : "manual_work: null",
    "files:",
    ...files.map((f) => `  - { path: ${f.path}, sha256: ${f.sha256} }`),
    `digest: ${digest}`,
    "",
  ].join("\n");
  write(join(dir, "edition.yaml"), y);
  return sha256(readFileSync(join(dir, "edition.yaml")));
}
function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(dir, rel ? `${rel}/${d.name}` : d.name) : [rel ? `${rel}/${d.name}` : d.name]);
}
/** The pin on <ns> <version> in a design's engine.yaml := the edition's hash. */
function pin(design: string, ns: string, version: string, hash: string) {
  const eng = join(design, "engine.yaml");
  const re = new RegExp(`(\\{ namespace: ${ns}, version: "${version.replace(/\./g, "\\.")}", sha256: )[^ }]+`);
  const text = read(eng);
  if (!re.test(text)) throw new Error(`${eng}: no pin on ${ns} ${version}`);
  write(eng, text.replace(re, `$1${hash}`));
}

// ── The example portfolio ──
const EX = join(DE, "examples");
rehashRoot(join(EX, "shared"));
const premerge100 = freeze({
  design: join(EX, "designs/premerge"), root: join(EX, "shared"), version: "1.0.0", date: "2026-10-28", build: "example-1.0.0",
  // 1.0.0 kept one check workspace per repository; the working copy gives each run its own
  model: (t) => t.replace("    workspace: per-run\n", "    workspace: per-repository\n")
    .replace(/^# Working copy\.[\s\S]*?\n(?=systems:)/m, "# Released edition 1.0.0, frozen: the working copy beside editions/ is newer.\n"),
});
pin(join(EX, "designs/intake"), "premerge", "1.0.0", premerge100);

// ── The test fixtures: a clean base and the variants that carry hashes ──
const FX = join(HERE);
rehashRoot(join(FX, "base/shared"));
if (existsSync(join(FX, "variants/one-root/shared2"))) rehashRoot(join(FX, "variants/one-root/shared2"));
if (existsSync(join(FX, "variants/xref-pin-stale"))) {
  // The variant holds a released beta 1.0.0, frozen from the base's beta when its entry part still said
  // batch: nightly. The base's working copy no longer does, so alpha's pin on 1.0.0 is stale in the working view.
  const v = join(FX, "variants/xref-pin-stale");
  const h = freeze({
    design: join(FX, "base/designs/beta"), out: join(v, "designs/beta/editions/1.0.0"), root: join(FX, "base/shared"),
    version: "1.0.0", date: "2026-10-28", build: "fixture-1.0.0",
    model: (t) => {
      const next = t.replace("    description: Takes the spec in.\n", "    description: Takes the spec in.\n    batch: nightly\n");
      if (next === t) throw new Error("base beta model.yaml: no 'Takes the spec in.' part to mark");
      return next;
    },
  });
  pin(join(v, "designs/alpha"), "beta", "1.0.0", h);
}
console.log(changed ? `${changed} file(s) written` : "every hash already current");
