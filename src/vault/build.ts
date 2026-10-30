// A vault is a generated view. Only the human region can travel back, through core/notes.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { Bundle, CurrentState, Finding, Model, Note, NoteTargetKind, Plan } from "../types.ts";
import { buildBundle, ENGINE_VERSION } from "../core/bundle.ts";
import { runPortfolio } from "../core/portfolio.ts";
import { canonicalJson, natCompare, sha256 } from "../core/util.ts";
import { findingNoteId, loadNotes, notesVersion, NOTE_TEXT_MAX, writeNoteEdit } from "../core/notes.ts";
import { unitRoles } from "../core/teams.ts";
import { leakCheck, type LeakHit } from "../dev/package.ts";
import { loadScrubList } from "../core/scrub.ts";

export const HUMAN_START = "<!-- plumb:human:start -->\n";
export const HUMAN_END = "<!-- plumb:human:end -->";
const MANIFEST = ".plumb-vault.json";
const LEGACY_MANIFEST = ".de-vault.json";
type Raw = Record<string, any>;
type Kind = "part" | "relationship" | "contract" | "unit" | "milestone" | "team" | "finding" | "design" | "portfolio";
interface Page {
  key: string; file: string; kind: Kind; id: string; design: string; name: string;
  fields: Raw; body: string[]; refs: { kind: Kind; id: string; label: string }[];
  target: { kind: NoteTargetKind; id: string }; source: string;
}
interface Stamp { key: string; generated: string }
interface Manifest { format: 1; engine: string; target: string; files: Record<string, Stamp> }
export interface VaultOptions { today?: string; packaging?: boolean; scrubList?: string; now?: () => string }
export interface VaultResult { out: string; notes: number; counts: Record<string, number>; imported: number; errors: number; conflicts: string[]; leaks: LeakHit[]; namesChecked: boolean; ok: boolean }
const qualified = (id: string, ns: string) => id.includes(":") ? id : `${ns}:${id}`;
const home = (id: string) => id.split(":")[0];
const local = (id: string, ns: string) => id.startsWith(ns + ":") ? id.slice(ns.length + 1) : id;
const kindOf = (kind: string): Kind => kind === "element" ? "part" : kind === "phase" ? "milestone" : kind as Kind;
const key = (kind: Kind, id: string) => `${kind}:${id}`;
// Preserve names, spaces and Unicode; avoid path, filesystem and wikilink syntax.
function readableName(name: string): string {
  let text = name.normalize("NFC").replace(/[<>:"/\\|?*\[\]#^\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "");
  if (!text) text = "Untitled";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(text)) text = "_" + text;
  return text;
}
function basename(name: string): string {
  let text = readableName(name);
  // Leave room for a distinguishing suffix on filesystems with a 255-byte limit.
  while (Buffer.byteLength(text) > 180) text = Array.from(text).slice(0, -1).join("");
  return text.trimEnd().replace(/\.+$/, "");
}
const folded = (file: string) => file.normalize("NFC").toLowerCase();
function namePages(pages: Page[]): void {
  const bases = new Map(pages.map((p) => [p.key, basename(p.name)]));
  const counts = new Map<string, number>();
  for (const base of bases.values()) counts.set(folded(base), (counts.get(folded(base)) ?? 0) + 1);
  const reserved = new Set([...bases.values()].map(folded)), used = new Set<string>();
  for (const p of [...pages].sort((a, b) => natCompare(a.key, b.key))) {
    const base = bases.get(p.key)!;
    let name = base;
    if (counts.get(folded(base))! > 1) {
      const hash = sha256(p.key);
      let length = 8;
      do {
        name = `${base} (${hash.slice(0, length++)})`;
        if (length > hash.length + 1) throw new Error("vault filename collision");
      } while (reserved.has(folded(name)) || used.has(folded(name)));
    }
    p.file = name + ".md"; used.add(folded(name));
  }
}

/** A single explicit region. Delimiters belong to the generated shell, including their line endings. */
export function humanRegion(text: string): { human: string; shell: string } | undefined {
  const starts = [...text.matchAll(/<!-- (?:plumb|de):human:start -->\n/g)];
  const ends = [...text.matchAll(/<!-- (?:plumb|de):human:end -->/g)];
  if (starts.length !== 1 || ends.length !== 1) return undefined;
  const start = starts[0], end = ends[0], a = start.index!, b = end.index!;
  if (b < a + start[0].length || start[0].includes("plumb:") !== end[0].includes("plumb:")) return undefined;
  return { human: text.slice(a + start[0].length, b), shell: text.slice(0, a + start[0].length) + text.slice(b) };
}

async function pagesFor(target: string, opts: VaultOptions): Promise<{ pages: Page[]; identity: string; errors: number; sources: string[] }> {
  // A non-date build disables time-relative checks. Date-relative status is opt-in and reproducible.
  const built = opts.today ? `${opts.today}T00:00:00Z` : "vault";
  const isPortfolio = /portfolio\.ya?ml$/.test(target) || existsSync(join(target, "portfolio.yaml"));
  const pages: Page[] = [];
  const dirs = new Map<string, string>();
  const bundles = new Map<string, Bundle>();
  const currents = new Map<string, CurrentState>();
  let model: Model, plan: Plan, identity: string, title: string, errors: number;
  let findings: { f: Finding; design: string; id: string }[];
  let portfolioDir: string | undefined;
  if (isPortfolio) {
    const run = await runPortfolio(target, { built });
    if (run.data.stopped || !run.graph || run.designs.some((d) => !d.bundle)) throw new Error("portfolio could not compose every design; no vault written");
    model = run.graph.model; plan = run.graph.plan;
    identity = `portfolio:${run.file.name}`; title = run.file.title; portfolioDir = run.file.dir;
    dirs.set("shared", run.root.dir); dirs.set("org", run.root.dir); dirs.set("root", run.root.dir);
    for (const d of run.designs) { dirs.set(d.namespace, d.dir); bundles.set(d.namespace, d.bundle!); }
    findings = run.data.findings.map((f) => ({ f, design: f.design ?? "root", id: `${f.design ?? "root"}:${findingNoteId(f)}` }));
    errors = run.data.findings.filter((f) => f.severity === "error").length;
  } else {
    const { bundle: b, instance } = await buildBundle(target, { built });
    const ns = b.instance.namespace ?? b.instance.name;
    dirs.set(ns, instance.dir); bundles.set(ns, b);
    if (instance.ns?.root) { dirs.set("shared", instance.ns.root.dir); dirs.set("org", instance.ns.root.dir); }
    // Normalize the standalone bundle's own ids without changing its resolved foreign ids.
    const q = (id: string) => qualified(id, ns);
    model = structuredClone(b.model); plan = structuredClone(b.plan);
    for (const group of [model.elements, model.relationships, model.teams]) for (const r of group) r.id = q(r.id);
    for (const r of model.elements) for (const field of ["owner", "parent", "verifier"] as const) if (r[field]) r[field] = q(r[field]!);
    for (const r of model.relationships) { r.from = q(r.from); r.to = q(r.to); r.carries = r.carries?.map(q); }
    for (const r of model.contracts) { r.name = q(r.name); r.produced_by = r.produced_by?.map(q); r.consumed_by = r.consumed_by?.map(q); }
    for (const r of plan.phases) r.id = q(r.id);
    for (const r of plan.units) { r.id = q(r.id); r.phase = q(r.phase); if (r.owner) r.owner = q(r.owner); r.elements = r.elements?.map((m) => ({ ...m, id: q(m.id) })); }
    findings = b.findings.map((f) => ({ f: { ...f, at: q(f.at) }, design: ns, id: `${ns}:${findingNoteId(f)}` }));
    identity = `design:${ns}`; title = b.instance.title; errors = b.findings.filter((f) => f.severity === "error").length;
  }
  const roleIds = new Set(model.teams.filter((t) => !t.id.includes(":")).map((t) => t.id));
  for (const t of model.teams) if (roleIds.has(t.id)) t.id = qualified(t.id, t.home ?? "shared");
  for (const e of model.elements) if (e.owner && roleIds.has(e.owner)) e.owner = qualified(e.owner, "shared");
  for (const [ns, b] of bundles) for (const c of b.current?.records ?? []) currents.set(qualified(c.part, ns), c);
  const roles = unitRoles(model, plan);
  function add(kind: Kind, id: string, name: string, fields: Raw, body: string[] = [], refs: Page["refs"] = [], override?: { design: string; source: string; target: Page["target"] }) {
    const design = override?.design ?? home(id);
    const source = override?.source ?? dirs.get(design);
    if (!source) return; // an outside record has no editable home in this vault
    const tk = kind === "part" ? "element" : kind === "milestone" ? "phase" : kind;
    const targetId = design === "shared" || design === "org" ? id : local(id, design);
    pages.push({ key: key(kind, id), file: "", kind, id, design, name, source, fields, body, refs, target: override?.target ?? { kind: tk as NoteTargetKind, id: targetId } });
  }
  const ref = (kind: Kind, id: string, label: string) => ({ kind, id, label });
  for (const e of model.elements) {
    const c = currents.get(e.id);
    add("part", e.id, e.name, { record: e, status: c?.state ?? "unrecorded", state: c?.state ?? "unrecorded", owner_team: e.owner ? [e.owner] : [], baseline: c?.baseline ?? null, disposition: c?.disposition ?? null, found: c?.found ?? null, confirmed: c?.confirmed ?? null, refused: c?.refused ?? null, today_only: !!e.todayOnly },
      [e.description ?? "", c ? c.state === "discovered" ? `**Discovered only. Not confirmed.** ${c.text}` : `**Confirmed.** ${c.text}` : "Current state has not been recorded."],
      [...(e.owner ? [ref("team", e.owner, "Owner team")] : []), ...(e.parent ? [ref("part", e.parent, "Parent")] : []), ...(c?.replaced_by ? [ref("part", qualified(c.replaced_by, home(e.id)), "Replaced by")] : [])]);
  }
  for (const r of model.relationships) add("relationship", r.id, r.label ?? local(r.id, home(r.id)), { record: r, status: "declared" }, [], [ref("part", r.from, "From"), ref("part", r.to, "To"), ...(r.carries ?? []).map((id) => ref("contract", id, "Carries"))]);
  for (const c of model.contracts) add("contract", c.name, local(c.name, home(c.name)), { record: c, status: "declared" }, [c.description ?? ""], [...(c.produced_by ?? []).map((id) => ref("part", id, "Produced by")), ...(c.consumed_by ?? []).map((id) => ref("part", id, "Consumed by"))]);
  for (const t of model.teams) add("team", t.id, t.name, { record: t, status: "declared", owner_team: [t.id] }, [t.description ?? ""]);
  for (const u of plan.units) add("unit", u.id, u.title, { record: u, elements: u.elements ?? [], requires: u.requires ?? [], provides: u.provides ?? [], status: u.status ?? "todo", owner_team: roles[u.id]?.owners ?? [] }, [u.check], [ref("milestone", u.phase, "Milestone"), ...(u.elements ?? []).map((m) => ref("part", m.id, `${m.from} to ${m.to}`)), ...(roles[u.id]?.owners ?? []).map((id) => ref("team", id, "Owner team"))]);
  for (const p of plan.phases) {
    const ns = home(p.id), status = bundles.get(ns)?.status?.milestones.find((m) => qualified(m.phase, ns) === p.id);
    add("milestone", p.id, p.name, { record: p, status: status?.status ?? "unrecorded", computed: status?.computed ?? null }, [p.delivers ?? "", p.means ?? "", p.exit_test], plan.units.filter((u) => u.phase === p.id).map((u) => ref("unit", u.id, "Work")));
  }
  // A rule can emit several messages for the same subject. Keep each, with stable identity.
  const seenFindings = new Map<string, number>();
  for (const { f, design, id: base } of findings) {
    const digest = sha256(canonicalJson(f)).slice(0, 12), group = base + ":" + digest;
    const occurrence = (seenFindings.get(group) ?? 0) + 1; seenFindings.set(group, occurrence);
    const id = `${group}:${occurrence}`;
    const source = f.pack === "portfolio" && portfolioDir ? portfolioDir : dirs.get(design) ?? portfolioDir;
    if (!source) continue;
    const subject = f.at.includes(":") ? f.at : qualified(f.at, design);
    const subjectKind = kindOf(f.atKind);
    const owner = model.elements.find((e) => e.id === subject)?.owner;
    add("finding", id, `${f.pack}/${f.rule}: ${f.at}`, { record: f, status: f.severity, owner_team: owner ? [owner] : [] }, [f.message], [ref(subjectKind, subject, "Subject")], { design, source, target: { kind: "finding", id: findingNoteId({ ...f, at: local(f.at, design) }) } });
  }
  for (const [ns, b] of bundles) {
    const id = ns;
    add("design", id, b.instance.title, { status: b.status?.overall.status ?? "unrecorded", description: b.instance.description ?? "" }, [b.instance.description ?? ""], [], { design: ns, source: dirs.get(ns)!, target: { kind: "design", id: ns } });
  }
  if (portfolioDir) add("portfolio", identity.slice(10), title, { status: errors ? "error" : "pass" }, [], [], { design: "portfolio", source: portfolioDir, target: { kind: "portfolio", id: identity.slice(10) } });
  const unique = new Map<string, Page>();
  for (const p of pages) { if (unique.has(p.key)) throw new Error(`duplicate vault identity ${p.key}`); unique.set(p.key, p); }
  for (const p of pages.filter((p) => p.kind === "design" || p.kind === "portfolio")) p.refs = pages.filter((other) => other !== p && (p.kind === "portfolio" ? other.kind === "design" || ["shared", "org", "root"].includes(other.design) : other.design === p.design)).map((other) => ref(other.kind, other.id, other.name));
  namePages(pages);
  return { pages: pages.sort((a, b) => natCompare(a.file, b.file)), identity, errors, sources: [...new Set(dirs.values()), ...(portfolioDir ? [portfolioDir] : [])] };
}

const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const prose = new Set(["description", "check", "feedback", "exit_test", "delivers", "means", "message", "text"]);
const label = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("[", "&#91;").replaceAll("]", "&#93;").replaceAll("|", "&#124;").replace(/[\r\n]+/g, " ");
const wikilink = (p: Page) => `[[${p.file.slice(0, -3)}|${label(p.name)}]]`;
function properties(p: Page, today?: string): Raw {
  const record = p.fields.record ?? {};
  const filterable = (k: string, v: unknown) => scalar(v) && !prose.has(k) && !["attrs", "record", "found", "confirmed"].includes(k);
  const fields = Object.fromEntries(Object.entries(record).filter(([k, v]) => filterable(k, v)));
  const derived = Object.fromEntries(Object.entries(p.fields).filter(([k, v]) => filterable(k, v)));
  const front: Raw = { ...fields, record_kind: record.kind ?? null, id: p.id, kind: p.kind, design: p.design, name: p.name, aliases: [p.name, p.id], status: "declared", owner_team: p.fields.owner_team ?? [], as_of: today ?? null, ...derived };
  if (p.kind === "part") {
    for (const [prefix, keys] of [["found", ["by", "agent", "from", "as_of", "confidence"]], ["confirmed", ["by", "at"]]] as const) {
      for (const k of keys) front[`${prefix}_${k}`] = p.fields[prefix]?.[k] ?? null;
    }
  }
  return front;
}
function details(fields: Raw, indent = ""): string[] {
  const title = (s: string) => label(s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()));
  const value = (v: unknown): string => v === null ? "Not recorded" : label(String(v));
  return Object.entries(fields).filter(([, v]) => v !== undefined).sort(([a], [b]) => natCompare(a, b)).flatMap(([k, v]) => {
    const head = `${indent}- **${title(k)}:**`;
    if (Array.isArray(v)) return v.length ? [head, ...v.flatMap((item) => item && typeof item === "object" ? [`${indent}  -`, ...details(item, indent + "    ")] : [`${indent}  - ${value(item)}`])] : [head + " None"];
    if (v && typeof v === "object") return Object.keys(v).length ? [head, ...details(v, indent + "  ")] : [head + " None"];
    return [head + " " + value(v)];
  });
}

function render(p: Page, pages: Map<string, Page>, human = "", today?: string): string {
  const sourceNotes = loadNotes(p.source);
  const notes = sourceNotes?.notes.filter((n) => n.target.kind === p.target.kind && n.target.id === p.target.id) ?? [];
  const links = p.refs.map((r) => {
    const to = pages.get(key(r.kind, r.id));
    return to ? `- ${label(r.label)}: ${wikilink(to)}` : `- ${label(r.label)}: ${label(r.id)} (outside this vault or unresolved)`;
  });
  const index = pages.get(key("design", p.design));
  if (index && index !== p) links.unshift(`- Design: ${wikilink(index)}`);
  const record = p.fields.record ?? {};
  const front = properties(p, today);
  const remaining = Object.fromEntries(Object.entries({ ...record, ...p.fields }).filter(([k, v]) => !["record", "found", "confirmed"].includes(k) && !(k in front) && !p.body.includes(v as string)));
  const detail = details(remaining).join("\n");
  // JSON flow values keep scalars and lists typed without nested property blobs.
  const yaml = Object.entries(front).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${canonicalJson(v).replaceAll("<", "\\u003c")}`).join("\n");
  const generated = `---\n${yaml}\n---\n\n# ${label(p.name)}\n\nGenerated by Plumb ${ENGINE_VERSION}. Record changes require the engine's proposal and decision path.\n\n${p.body.filter(Boolean).join("\n\n")}\n\n${links.join("\n")}\n\n## Record details\n\n${detail || "No additional record details."}\n\n## Engine notes\n\n${notes.length ? notes.map((n) => `### ${n.id} (${n.kind}, ${n.status})\n\n${n.text}${n.answer ? `\n\nAnswer (${n.answered_by ?? "unrecorded"}): ${n.answer}` : ""}`).join("\n\n") : "No engine notes."}\n\n## Human notes\n\nWrite between the markers. Regeneration preserves this text and imports non-empty revisions as open proposal notes in notes.yaml.\n\n`;
  return generated.replace(/<!-- (plumb|de):human:/g, "&lt;!-- $1:human:") + HUMAN_START + human + HUMAN_END + "\n";
}

function walk(dir: string, prefix = "", includeSettings = false): string[] {
  if (!existsSync(dir)) return [];
  if (lstatSync(dir).isSymbolicLink()) throw new Error("vault output is a symbolic link");
  return readdirSync(dir).sort().flatMap((n) => {
    if (n === ".obsidian" && !includeSettings && !prefix) return []; // Obsidian owns its settings. Packaging scans them too.
    const rel = prefix ? `${prefix}/${n}` : n, path = join(dir, n), st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error(`vault contains a symbolic link: ${rel}`);
    return st.isDirectory() ? walk(path, rel, includeSettings) : [rel];
  });
}

export async function buildVault(targetIn: string, outIn: string, opts: VaultOptions = {}): Promise<VaultResult> {
  if (opts.today && (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today) || new Date(opts.today + "T00:00:00Z").toISOString().slice(0, 10) !== opts.today)) throw new Error("--today needs a valid YYYY-MM-DD date");
  const target = resolve(targetIn), out = resolve(outIn);
  let data = await pagesFor(target, opts);
  for (const source of data.sources) if (out === resolve(source) || resolve(source).startsWith(out + sep)) throw new Error("vault output cannot contain source inputs");
  const result: VaultResult = { out, notes: data.pages.length, counts: {}, errors: data.errors, imported: 0, conflicts: [], leaks: [], namesChecked: false, ok: false };
  for (const p of data.pages) result.counts[p.kind] = (result.counts[p.kind] ?? 0) + 1;
  const existing = walk(out);
  if (existsSync(join(out, MANIFEST)) && existsSync(join(out, LEGACY_MANIFEST))) throw new Error("vault has two manifests; retain one verified manifest before regenerating");
  const manifestName = existsSync(join(out, LEGACY_MANIFEST)) ? LEGACY_MANIFEST : MANIFEST;
  const manifestPath = join(out, manifestName);
  let before: Manifest | undefined;
  if (existsSync(manifestPath)) {
    before = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (before?.format !== 1 || before.target !== data.identity || !before.files) throw new Error("vault manifest does not belong to this target");
  } else if (existing.length) throw new Error("vault output must be empty or have its generated manifest");
  const humans = new Map<string, string>();
  const oldFiles = new Map<string, string>();
  for (const [file, stamp] of Object.entries(before?.files ?? {})) {
    if (!file.endsWith(".md") || Buffer.byteLength(file) > 255 || readableName(file.slice(0, -3)) !== file.slice(0, -3)) throw new Error("invalid file in vault manifest");
    if (!stamp || typeof stamp.key !== "string" || typeof stamp.generated !== "string" || !/^[a-f0-9]{64}$/.test(stamp.generated) || oldFiles.has(stamp.key)) throw new Error("invalid identity in vault manifest");
    oldFiles.set(stamp.key, file);
    const path = join(out, file);
    if (!existsSync(path)) { result.conflicts.push(`${file}: generated note is missing`); continue; }
    const region = humanRegion(readFileSync(path, "utf8"));
    if (!region || sha256(region.shell) !== stamp.generated) result.conflicts.push(`${file}: edited outside its human region`);
    else humans.set(stamp.key, region.human);
  }
  const intended = new Set(data.pages.map((p) => p.key));
  for (const f of existing) if (f !== manifestName && !before?.files[f]) result.conflicts.push(`${f}: unmanaged file`);
  for (const [id, f] of oldFiles) if (!intended.has(id)) result.conflicts.push(`${f}: record no longer generated; retained for review`);
  for (const p of data.pages) if ((humans.get(p.key)?.trim().length ?? 0) > NOTE_TEXT_MAX - 100) result.conflicts.push(`${p.file}: human notes exceed the note text limit`);
  if (result.conflicts.length) return result;
  let byKey = new Map(data.pages.map((p) => [p.key, p]));
  const rendered = () => {
    const output = new Map(data.pages.map((p) => [p.file, render(p, byKey, humans.get(p.key), opts.today)]));
    const fileKeys = new Map(data.pages.map((p) => [p.file, p.key]));
    const manifest: Manifest = { format: 1, engine: ENGINE_VERSION, target: data.identity, files: Object.fromEntries([...output].map(([f, t]) => [f, { key: fileKeys.get(f)!, generated: sha256(humanRegion(t)!.shell) }])) };
    output.set(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    return output;
  };
  let output = rendered();
  const scrub = loadScrubList(opts.scrubList, () => {}); result.namesChecked = scrub.found;
  // Stage before any source write. A failed packaging check neither imports notes nor changes the old vault.
  const scan = () => {
    const stage = mkdtempSync(join(tmpdir(), "plumb-vault-check-"));
    const scanned = new Map(output);
    for (const f of walk(out, "", true).filter((f) => f === ".obsidian" || f.startsWith(".obsidian/"))) scanned.set(f, readFileSync(join(out, f), "utf8"));
    for (const [f, text] of scanned) { mkdirSync(dirname(join(stage, f)), { recursive: true }); writeFileSync(join(stage, f), text); }
    return leakCheck(stage, [...scanned.keys()], scrub.list.map(([re]) => re), [], { strictEmails: true, strictHomePaths: true });
  };
  if (opts.packaging) { result.leaks = scan(); if (result.leaks.length) return result; }
  // Content identities make retries idempotent, even if a run stops after a source write.
  for (const p of data.pages) {
    const human = humans.get(p.key) ?? "";
    if (!human.trim()) continue;
    const current = loadNotes(p.source);
    if (current?.problems.length) throw new Error("notes.yaml has problems; repair before syncing vault notes");
    const source = `vault:${p.key}:${sha256(human)}`;
    const proposalId = `V-${sha256(source).slice(0, 32)}`;
    if (current?.notes.some((n) => n.id === proposalId || n.sources?.includes(source))) continue;
    const now = (opts.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")))();
    const note: Note = { id: proposalId, target: p.target, kind: "note", text: `Proposal from the vault. Review through the engine note workflow.\n\n${human.trim()}`, status: "open", author: "person", sources: [source], created: now, updated: now };
    writeNoteEdit(p.source, current?.version ?? notesVersion(undefined), { op: "add", note }); result.imported++;
  }
  if (result.imported) {
    data = await pagesFor(target, opts); byKey = new Map(data.pages.map((p) => [p.key, p]));
    // A new notes file can add note checks. Fresh identities are safe after preflight.
    output = rendered();
    result.notes = data.pages.length; result.errors = data.errors; result.counts = {};
    for (const p of data.pages) result.counts[p.kind] = (result.counts[p.kind] ?? 0) + 1;
  }
  const finalKeys = new Set(data.pages.map((p) => p.key));
  for (const [id, f] of oldFiles) if (!finalKeys.has(id)) result.conflicts.push(`${f}: record no longer generated; retained for review`);
  if (result.conflicts.length) return result;
  if (opts.packaging) { result.leaks = scan(); if (result.leaks.length) return result; }
  mkdirSync(out, { recursive: true });
  // Move verified notes, never delete them. Stage all moves first so name swaps and
  // case-only renames cannot overwrite another record's human region.
  const moves = data.pages.filter((p) => oldFiles.has(p.key) && oldFiles.get(p.key) !== p.file);
  if (moves.length) {
    const stage = mkdtempSync(join(dirname(out), ".plumb-vault-renames-"));
    for (const [i, p] of moves.entries()) renameSync(join(out, oldFiles.get(p.key)!), join(stage, `${i}.md`));
    for (const [i, p] of moves.entries()) renameSync(join(stage, `${i}.md`), join(out, p.file));
  }
  if (manifestName === LEGACY_MANIFEST) renameSync(manifestPath, join(out, MANIFEST));
  for (const [f, t] of output) writeFileSync(join(out, f), t);
  result.ok = true;
  return result;
}

export async function vaultCli(args: string[]): Promise<number> {
  const target = args[0], oi = args.indexOf("--out"), ti = args.indexOf("--today");
  if (!target || target.startsWith("--") || oi < 0 || !args[oi + 1] || args[oi + 1].startsWith("--") || (ti >= 0 && (!args[ti + 1] || args[ti + 1].startsWith("--")))) throw new Error("usage: plumb vault <instance or portfolio> --out <dir> [--packaging] [--today YYYY-MM-DD]");
  const known = new Set([0, oi, oi + 1, ...(ti >= 0 ? [ti, ti + 1] : []), ...args.flatMap((a, i) => a === "--packaging" ? [i] : [])]);
  if (args.some((_, i) => !known.has(i))) throw new Error("unknown vault option");
  const r = await buildVault(target, args[oi + 1], { packaging: args.includes("--packaging"), ...(ti >= 0 ? { today: args[ti + 1] } : {}) });
  for (const c of r.conflicts) console.error(c);
  for (const h of r.leaks) console.error(`${h.file}:${h.line}: ${h.what}`);
  if (!r.ok) { console.error("Vault refused. Existing output retained."); return 1; }
  console.log(`Wrote ${r.notes} vault notes. Imported ${r.imported} proposal notes. Findings: ${r.errors} errors.`);
  console.log(JSON.stringify(r.counts));
  if (args.includes("--packaging")) console.log(`Package leak check passed. ${r.namesChecked ? "Scrub-list names checked." : "Scrub-list names NOT checked (no scrub list found)."}`);
  return r.errors ? 1 : 0;
}
