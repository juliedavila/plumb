// Impact of one patch: compile with and without it (whatever its status) and diff.

import type { ChangeSide, ChangeNeighbourhood, FieldChange, Finding, Impact, ImpactDrawing, ViewChange, Instance, Model, Patch, PatchVerdict, Plan, RecordKind, RecordSnapshot, RulePack, Unit, View } from "../types.ts";
import { layoutView, nodeSize, viewRelationships } from "./layout.ts";
import { compile, emptyResult, type Compiled } from "./compile.ts";
import { DEFAULT_LADDER, patchKey } from "./load.ts";
import { buildContext, compareFindings, corePack, dedupeFindings, findingKey, runRules } from "./rules.ts";
import { dropOutsideFindings } from "./resolve.ts";
import { currentContext, currentFacts } from "./current.ts";
import { PROSE } from "../site/prose.ts";
import { flowSettings, flowSteps, patchFlowEffect } from "./flow.ts";
import { instanceMeasured } from "./flow-measured.ts";
import { natCompare, natSort } from "./util.ts";
import { composeGraph } from "./portfolio.ts";
import { readPremiseLinks } from "./premise-links.ts";

export function checkCompiled(inst: Instance, c: Compiled, packs: RulePack[]): Finding[] {
  const ns = inst.ns ? { ns: { ...(inst.ns.namespace ? { own: inst.ns.namespace } : {}), rooted: !!inst.ns.root } } : {};
  const ctx = buildContext(inst.config, c.model, c.plan, inst.tracker, { notes: inst.notes?.notes, patchIds: inst.patches.map((p) => p.id), patches: inst.patches.map((p) => ({ id: p.id, why: p.why })), ...ns });
  ctx.today = "asOf" in inst ? inst.asOf : new Date().toISOString().slice(0, 10);
  if (inst.ns?.root?.input) ctx.rootInput = inst.ns.root.input; // a rooted design: the seam rule reads its shared seams and exceptions
  // a 0.4 design's current state, for the plan pack's rules that read it (src/core/current.ts)
  if (c.current) ctx.current = currentFacts(c.current, currentContext(inst, inst.config.ladder ?? DEFAULT_LADDER));
  // The load-bearing check uses the composed scope below, with the same impact walk as the bundle.
  const localPacks = inst.ns ? packs.map((p) => p.name === "premises" ? { ...p, rules: p.rules.filter((r) => r.id !== "load-bearing-untested") } : p) : packs;
  let out = runRules(localPacks, ctx);
  if (!inst.ns) return out;
  const premises = packs.find((p) => p.name === "premises");
  if (premises) {
    const namespace = inst.ns.namespace ?? inst.config.name;
    const designs = [{ namespace, dir: inst.dir, title: inst.config.title, model: c.model, plan: c.plan, pins: inst.ns.pins }, ...(inst.ns.compose ?? [])];
    const graph = composeGraph(inst.ns.root?.input, designs.map((d) => ({ d, config: inst.config })), inst.config.name, inst.config.title);
    const evidence = readPremiseLinks(inst.ns.root?.dir, graph.model, designs.map((d) => d.namespace));
    const pc = buildContext(inst.config, graph.model, graph.plan);
    pc.premiseLinks = evidence.data.links;
    const own = new Map((c.model.claims ?? []).map((cl) => [cl.id.includes(":") ? cl.id : `${namespace}:${cl.id}`, cl.id]));
    const scoped = runRules([{ ...premises, rules: premises.rules.filter((r) => r.id === "load-bearing-untested") }], pc)
      .filter((f) => own.has(f.at)).map((f) => ({ ...f, at: own.get(f.at)!, message: f.message.replaceAll(`${namespace}:`, "") }));
    out.push(...scoped);
  }
  // a 0.4 design: rules about records it does not own are skipped, and resolution's and current state's findings join the rest
  return dedupeFindings([...dropOutsideFindings(out, c.model), ...(c.ns?.findings ?? []), ...(c.current?.findings ?? [])]).sort(compareFindings);
}

/** Find a patch by its key (file) first, then by id (the first of that id). */
export function findPatch(inst: Pick<Instance, "patches">, ref: string): Patch | undefined {
  return inst.patches.find((p) => patchKey(p) === ref) ?? inst.patches.find((p) => p.id === ref);
}

/** Ids present in a compiled state, per record kind (contracts by name). */
function recordIds(c: Compiled): Map<string, Set<string>> {
  const m = c.model, p = c.plan;
  const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
  return new Map<string, Set<string>>([
    ["element", ids(m.elements)], ["relationship", ids(m.relationships)], ["contract", new Set(m.contracts.map((x) => x.name))],
    ["team", ids(m.teams)], ["system", ids(m.systems)], ["zone", ids(m.zones)], ["view", ids(m.views)],
    ["unit", ids(p.units)], ["phase", ids(p.phases)], ["claim", ids(m.claims ?? [])],
  ]);
}

export function computeImpact(inst: Instance, patchRef: string, packs: RulePack[], memo?: Map<string, { c: Compiled; f: Finding[] }>): Impact {
  const patch = findPatch(inst, patchRef);
  if (!patch) throw new Error(`unknown patch "${patchRef}"; known: ${inst.patches.map((p) => p.id).join(", ") || "(none)"}`);
  const key = patchKey(patch);

  const run = (memoKey: string, opts: Parameters<typeof compile>[1]) => {
    const hit = memo?.get(memoKey);
    if (hit) return hit;
    const c = compile(inst, opts);
    const v = { c, f: checkCompiled(inst, c, packs) };
    memo?.set(memoKey, v);
    return v;
  };
  // Without: accepted patches minus this one. With: accepted patches plus this one.
  // For a patch that is not accepted, "without" is the plain accepted compile, shared across patches.
  const without = patch.status === "accepted" ? run(`without:${key}`, { without: key }) : run("accepted", {});
  const withP = patch.status === "accepted" ? run("accepted", {}) : run(`with:${key}`, { with: key });
  const r = withP.c.resultsByKey?.[key] ?? emptyResult();

  const before = new Set(without.f.map(findingKey)), after = new Set(withP.f.map(findingKey));
  const findingsIntroduced = withP.f.filter((f) => !before.has(findingKey(f))).sort(compareFindings);
  // A finding that goes away because the record it sits on is gone is not resolved: the problem left with the record.
  const idsBefore = recordIds(without.c), idsAfter = recordIds(withP.c);
  const recordGone = (f: Finding) => idsBefore.get(f.atKind)?.has(f.at) === true && idsAfter.get(f.atKind)?.has(f.at) === false;
  const disappeared = without.f.filter((f) => !after.has(findingKey(f))).sort(compareFindings);
  const findingsResolved = disappeared.filter((f) => !recordGone(f));
  const findingsGone = disappeared.filter(recordGone);

  // Units affected: units the patch touches directly or by cascade, units that move a touched element,
  // units that move an element at either end of a relationship the patch's ops add or remove,
  // and units whose capabilities overlap a touched unit's capabilities.
  const touched = [...r.added, ...r.removed, ...r.modified, ...r.cascade];
  const touchedUnits = new Set(touched.filter((t) => t.kind === "unit").map((t) => t.id));
  const touchedEls = new Set(touched.filter((t) => t.kind === "element").map((t) => t.id));
  // Relationships the patch's own ops add or remove. Relationships lost only by cascade are left out: their units
  // are already reached through the removed element, and their far ends are often hubs that many units touch.
  const relIds = new Set([...r.added, ...r.removed].filter((t) => t.kind === "relationship").map((t) => t.id));
  const relEnds = new Set<string>();
  for (const rel of [...without.c.model.relationships, ...withP.c.model.relationships])
    if (relIds.has(rel.id)) { relEnds.add(rel.from); relEnds.add(rel.to); }
  const allUnits: Unit[] = [...without.c.plan.units, ...withP.c.plan.units];
  const caps = new Set<string>();
  for (const u of allUnits) if (touchedUnits.has(u.id)) for (const c of [...(u.requires ?? []), ...(u.provides ?? [])]) caps.add(c);
  const affected = new Set(touchedUnits);
  for (const u of allUnits) {
    if (u.elements?.some((m) => touchedEls.has(m.id) || relEnds.has(m.id))) affected.add(u.id);
    if ([...(u.requires ?? []), ...(u.provides ?? [])].some((c) => caps.has(c))) affected.add(u.id);
  }

  const sb = { model: without.c.model, plan: without.c.plan }, sa = { model: withP.c.model, plan: withP.c.plan };
  const records: Record<string, RecordSnapshot> = {};
  for (const t of touched) {
    const snap = snapshot(sa, t.kind, t.id) ?? snapshot(sb, t.kind, t.id);
    if (snap) records[`${t.kind}:${t.id}`] = snap;
  }
  const fieldChanges: FieldChange[] = [];
  for (const m of r.modified) for (const field of m.fields) {
    const bv = fieldValue(recordOf(sb, m.kind, m.id), field), av = fieldValue(recordOf(sa, m.kind, m.id), field);
    fieldChanges.push({ kind: m.kind, id: m.id, field, ...(bv !== undefined ? { before: show(bv) } : {}), ...(av !== undefined ? { after: show(av) } : {}) });
  }
  // A unit whose every part the patch removed has nothing left to change: an error, not a missing owner.
  const orphans = orphanedUnits(without.c.plan, withP.c.plan, new Set(r.cascade.filter((x) => x.kind === "unit").map((x) => x.id)));
  for (const u of orphans) {
    const before = without.c.plan.units.find((x) => x.id === u)!;
    const parts = (before.elements ?? []).map((m) => snapshot(sb, "element", m.id)?.name ?? m.id);
    findingsIntroduced.push(orphanFinding(u, before.title, parts));
  }
  findingsIntroduced.sort(compareFindings);

  // What the title and why name, and whether the patch's own ops back it. A cascade backs a part, a relationship or a
  // unit (it really changes), but not a contract: losing a producer or consumer by cascade is not keeping it.
  const direct = new Set([...r.added, ...r.removed, ...r.modified].map((t) => `${t.kind}:${t.id}`));
  const touchedKeys = new Set(touched.map((t) => `${t.kind}:${t.id}`));
  const carried = new Set<string>();
  for (const rel of [...without.c.model.relationships, ...withP.c.model.relationships]) if (relIds.has(rel.id)) for (const c of rel.carries ?? []) carried.add(c);
  const backed = (m: { kind: RecordKind; id: string }) => m.kind === "contract"
    ? direct.has(`contract:${m.id}`) || carried.has(m.id)
    : touchedKeys.has(`${m.kind}:${m.id}`) || (m.kind === "element" && relEnds.has(m.id));
  const mentioned = mentions(`${patch.title}\n${patch.why}`, [sb, sa]);
  const unbacked = mentioned.filter((m) => !backed(m));
  const drawing = impactDrawing(sb.model, sa.model, r);

  const impact: Impact = {
    patch: patch.id, status: patch.status,
    added: r.added, removed: r.removed, modified: r.modified, cascade: r.cascade,
    findingsIntroduced, findingsResolved, findingsGone,
    unitsAffected: natSort(affected),
    errors: r.errors,
    records, ...(fieldChanges.length ? { fieldChanges } : {}),
    ...(mentioned.length ? { mentioned, unbacked } : {}),
    ...(drawing ? { drawing } : {}),
  };
  impact.verdict = patchVerdict(patch, impact, { before: sb, after: sa, packs });
  // The change drawing's two sides: each drawn part's findings and flow values before and after, so After and
  // Change draw what the patch leaves (a new wait, a finding gone), not what the accepted model holds today.
  if (drawing?.change) {
    const ids = new Set(drawing.change.elements);
    const asOf = ("asOf" in inst ? inst.asOf : undefined) ?? new Date().toISOString().slice(0, 10);
    const hasFlow = packs.some((p) => p.name === "flow");
    const side = (m: Model, fs: Finding[]): ChangeSide => {
      const findings: ChangeSide["findings"] = {};
      for (const f of fs) if (f.atKind === "element" && ids.has(f.at)) { const x = findings[f.at] ??= { n: 0, error: false }; x.n++; if (f.severity === "error") x.error = true; }
      if (!hasFlow) return { findings };
      const all = flowSteps(m, flowSettings(inst.config), asOf, instanceMeasured(inst));
      return { findings, flow: Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id))) };
    };
    drawing.change.sides = { before: side(sb.model, without.f), after: side(sa.model, withP.f) };
  }
  // The lead-time effect on each stream view, where the instance checks a value stream.
  if (packs.some((p) => p.name === "flow")) {
    // the parts whose flow values this patch writes itself (a modify that sets them, or an added part that carries them)
    const FK = ["wait_days", "work_days", "wip_limit"];
    const own = patch.ops.flatMap((o) => o.kind !== "element" ? [] : o.op === "modify" ? (FK.some((k) => k in ((o.set.attrs as Record<string, unknown>) ?? {}) || k in o.set) ? [o.id] : [])
      : o.op === "add" && FK.some((k) => k in (((o.value as Record<string, unknown>).attrs as Record<string, unknown>) ?? {})) ? [String(o.value.id)] : []);
    const fx = patchFlowEffect(inst.config, sb.model, sa.model, ("asOf" in inst ? inst.asOf : new Date().toISOString().slice(0, 10)) ?? "", instanceMeasured(inst), own);
    if (fx.length) impact.flow = fx;
  }
  return impact;
}

export const ORPHAN_RULE = "unit-keeps-a-part";

/** Units the cascade left with no part to move, although they moved at least one before. */
export function orphanedUnits(before: Plan, after: Plan, cascaded: Set<string>): string[] {
  const out: string[] = [];
  for (const u of after.units) {
    if (!cascaded.has(u.id) || (u.elements ?? []).length) continue;
    const b = before.units.find((x) => x.id === u.id);
    if ((b?.elements ?? []).length) out.push(u.id);
  }
  return natSort(out);
}

export function orphanFinding(unit: string, title: string, parts: string[]): Finding {
  return { pack: "core", rule: ORPHAN_RULE, severity: "error", at: unit, atKind: "unit",
    message: `Unit ${unit} (“${title}”) moved only ${parts.length === 1 ? "a part" : "parts"} the patch removes (${parts.join(", ")}), so it has nothing left to change; remove the unit or give it a part` };
}

/** The verdict: fail, caution or pass, with the reasons in words and the reject and revise lines. */
export function patchVerdict(patch: Patch, im: Impact, o: { before: Side; after: Side; packs: RulePack[] }): PatchVerdict {
  const { quote, list, count, verb, sentence } = PROSE;
  const ruleTitle = (f: Finding) => [corePack(true), ...o.packs].find((p) => p.name === f.pack)?.rules.find((x) => x.id === f.rule)?.title ?? f.rule;
  const nameAt = (f: Finding) => {
    const k = f.atKind as RecordKind;
    const s = RECORD_KINDS_SET.has(k) ? snapshot(o.after, k, f.at) ?? snapshot(o.before, k, f.at) : undefined;
    return s?.name ?? f.at;
  };
  const reasons: string[] = [], fixes: string[] = [];
  const errs = im.findingsIntroduced.filter((f) => f.severity === "error");
  if (errs.length) {
    reasons.push(sentence(`It breaks ${count(errs.length, "check")}: ${list(errs.map((f) => `${quote(ruleTitle(f))} on ${quote(nameAt(f))}`), { max: 4 })}`));
    for (const f of errs.slice(0, 3)) fixes.push(`it no longer breaks ${quote(ruleTitle(f))} on ${quote(nameAt(f))}`);
  }
  const gone = im.findingsGone ?? [];
  if (gone.length) {
    const on = [...new Set(gone.map(nameAt))];
    reasons.push(sentence(`${count(gone.length, "finding")} ${verb(gone.length, "disappears", "disappear")} only because the patch removes what ${verb(gone.length, "it sat", "they sat")} on (${list(on.map(quote), { max: 3 })}); that is not a fix`));
    fixes.push(`it says what takes over from ${list(on.map(quote), { max: 3 })}, so the problems those checks found are answered rather than removed with ${on.length === 1 ? "it" : "them"}`);
  }
  // Units the text names that the patch does not change: context when done, an unmet precondition when not.
  const unitsBefore = new Map(o.before.plan.units.map((u) => [u.id, u]));
  const doneCaps = new Set(o.before.plan.units.filter((u) => u.status === "done").flatMap((u) => u.provides ?? []));
  const unmet = (im.unbacked ?? []).filter((m) => m.kind === "unit" && unitsBefore.has(m.id) && unitsBefore.get(m.id)!.status !== "done");
  for (const m of unmet) {
    const u = unitsBefore.get(m.id)!;
    const state = u.status === "doing" ? "in progress, not done" : (u.requires ?? []).some((c) => !doneCaps.has(c)) ? "blocked" : "not started";
    reasons.push(sentence(`It names ${quote(u.title)} (${u.id}), which is ${state}: a precondition not met yet`));
  }
  // one clause for every unmet precondition: "it waits until “A” and “B” are done, or no longer depends on them"
  if (unmet.length) {
    const ts = unmet.map((m) => quote(unitsBefore.get(m.id)!.title));
    fixes.push(`it waits until ${list(ts, { max: 3 })} ${unmet.length === 1 ? "is" : "are"} done, or no longer depends on ${unmet.length === 1 ? "it" : "them"}`);
  }
  const claims = (im.unbacked ?? []).filter((m) => m.kind !== "unit");
  if (claims.length) {
    const names = claims.map((m) => quote(snapshot(o.after, m.kind, m.id)?.name ?? snapshot(o.before, m.kind, m.id)?.name ?? m.id));
    reasons.push(sentence(`Its title or why names ${list(names, { max: 4 })}, which no operation changes`));
    fixes.push(`its operations do what its title and why say about ${list(names, { max: 3 })}, or the text stops claiming it`);
  }
  const level: PatchVerdict["level"] = errs.length ? "fail" : reasons.length ? "caution" : "pass";
  const file = patch.file ?? `patches/${patch.id}.yaml`;
  const reject = patch.status === "rejected"
    ? `Rejected in ${file}. Reconsider by setting status: proposed there.`
    : `Reject: set status: rejected in ${file}, and record who decided and why under decision (by, at, reason).`;
  const ask = fixes.length ? `Revise ${patch.id} so that ${list(fixes.slice(0, 4), { conj: "and" })}` : "";
  // a passing patch has nothing the engine asks of it: a revision is the reviewer's own change
  const revise = ask ? `Revise: edit ops (or why) in ${file}, or tell Claude: “${ask.replace(/“/g, "‘").replace(/”/g, "’")}; keep its id and set provenance.based_on to the current model.”`
    : `Revise: nothing is asked of it; to change it anyway, edit ops (or why) in ${file}, or tell Claude what to change, keeping its id and setting provenance.based_on to the current model.`;
  return { level, reasons, reject, revise };
}

const RECORD_KINDS_SET = new Set<string>(["element", "relationship", "contract", "team", "system", "zone", "unit", "phase", "view", "claim"]);

type Side = { model: Model; plan: Plan };

function recordOf(side: Side, kind: RecordKind, id: string): Record<string, unknown> | undefined {
  const m = side.model, p = side.plan;
  const find = <T extends { id: string }>(xs: T[]) => xs.find((x) => x.id === id) as Record<string, unknown> | undefined;
  switch (kind) {
    case "element": return find(m.elements);
    case "relationship": return find(m.relationships);
    case "contract": return m.contracts.find((c) => c.name === id) as Record<string, unknown> | undefined;
    case "team": return find(m.teams);
    case "system": return find(m.systems);
    case "zone": return find(m.zones);
    case "view": return find(m.views);
    case "unit": return find(p.units);
    case "phase": return find(p.phases);
    case "claim": return find(m.claims ?? []);
  }
}

/** A field's value on a record; `attrs.x` reads x inside attrs (compile names attrs changes that way). */
export function fieldValue(rec: Record<string, unknown> | undefined, field: string): unknown {
  if (!rec) return undefined;
  if (field.startsWith("attrs.")) {
    const attrs = rec.attrs as Record<string, unknown> | undefined;
    return attrs && typeof attrs === "object" ? attrs[field.slice(6)] : undefined;
  }
  return rec[field];
}

/** A record named for display, from one side of the patch. */
export function snapshot(side: Side, kind: RecordKind, id: string): RecordSnapshot | undefined {
  const r = recordOf(side, kind, id) as any;
  if (!r) return undefined;
  if (kind === "relationship") {
    const name = (x: string) => side.model.elements.find((e) => e.id === x)?.name ?? x;
    return { kind, id, name: r.label ?? `${name(r.from)} to ${name(r.to)}`, from: r.from, to: r.to, relKind: r.kind, ...(r.label ? { label: r.label } : {}) };
  }
  const name = kind === "contract" ? r.name : kind === "unit" || kind === "view" ? r.title : kind === "claim" ? r.statement : r.name;
  return { kind, id, name: String(name ?? id) };
}

/** A field value as one line of text: lists joined, mappings as JSON. */
export function show(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const MENTION_KINDS: RecordKind[] = ["element", "relationship", "unit", "contract"];

/** Ids of elements, relationships, units and contracts the text names, in order of first mention. */
export function mentions(text: string, sides: Side[]): { kind: RecordKind; id: string }[] {
  const known = new Map<string, RecordKind>();
  for (const side of sides) {
    for (const e of side.model.elements) known.set(e.id, "element");
    for (const r of side.model.relationships) if (!known.has(r.id)) known.set(r.id, "relationship");
    for (const u of side.plan.units) if (!known.has(u.id)) known.set(u.id, "unit");
    for (const c of side.model.contracts) if (!known.has(c.name)) known.set(c.name, "contract");
  }
  const out: { kind: RecordKind; id: string; at: number }[] = [], seen = new Set<string>();
  const s = String(text ?? "");
  let pos = 0;
  for (const raw of s.split(/([\s,;:()\[\]{}"'`]+)/)) {
    const at = pos; pos += raw.length;
    const tok = raw.replace(/[.!?]+$/, "");
    const kind = known.get(tok);
    if (!kind || !MENTION_KINDS.includes(kind) || seen.has(`${kind}:${tok}`)) continue;
    seen.add(`${kind}:${tok}`); out.push({ kind, id: tok, at });
  }
  // Parts and contracts named in words: a part's name of two words or more ("Repair queue"), a contract's name split
  // at its capitals ("RepairNote" as "repair note"), either with a plural. Case does not matter.
  const phrases: { kind: RecordKind; id: string; words: string }[] = [];
  for (const side of sides) {
    for (const e of side.model.elements) phrases.push({ kind: "element", id: e.id, words: e.name });
    for (const c of side.model.contracts) phrases.push({ kind: "contract", id: c.name, words: c.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ") });
  }
  for (const p of phrases) {
    const w = p.words.trim().split(/\s+/);
    if (w.length < 2 || seen.has(`${p.kind}:${p.id}`)) continue;
    const esc = w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${esc.join("\\s+")}(e?s)?(?![\\p{L}\\p{N}])`, "iu").exec(s);
    if (!m) continue;
    seen.add(`${p.kind}:${p.id}`); out.push({ kind: p.kind, id: p.id, at: m.index + m[1].length });
  }
  return out.sort((a, b) => a.at - b.at).map(({ kind, id }) => ({ kind, id }));
}

/**
 * The curated view the patch touches most, drawn twice from one layout of the union of its before and after states,
 * so unchanged nodes sit in the same place in both. None when the patch touches no element of any view.
 */
export function impactDrawing(before: Model, after: Model, r: { added: { kind: RecordKind; id: string }[]; removed: { kind: RecordKind; id: string }[]; modified: { kind: RecordKind; id: string }[]; cascade: { kind: RecordKind; id: string }[] }): ImpactDrawing | undefined {
  const touchedEls = new Set<string>(), changed = new Set<string>(), touchedViews = new Set<string>();
  for (const t of [...r.added, ...r.removed, ...r.modified, ...r.cascade]) {
    if (t.kind === "element") touchedEls.add(t.id);
    if (t.kind === "view") touchedViews.add(t.id);
    if (t.kind === "relationship") for (const m of [before, after]) {
      const rel = m.relationships.find((x) => x.id === t.id);
      if (rel) { touchedEls.add(rel.from); touchedEls.add(rel.to); }
    }
  }
  for (const m of r.modified) if (m.kind === "element") changed.add(m.id);
  const viewIds = [...new Set([...before.views, ...after.views].map((v) => v.id))];
  const score = (id: string) => {
    const vb = before.views.find((v) => v.id === id), va = after.views.find((v) => v.id === id);
    const els = new Set([...(vb?.elements ?? []), ...(va?.elements ?? [])]);
    let n = 0; for (const e of els) if (touchedEls.has(e)) n++;
    return n + (touchedViews.has(id) && n ? 0.5 : 0);
  };
  // the more focused view wins a tie
  const size = (id: string) => new Set([...(before.views.find((v) => v.id === id)?.elements ?? []), ...(after.views.find((v) => v.id === id)?.elements ?? [])]).size;
  const ranked = viewIds.map((id) => ({ id, n: score(id) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || size(a.id) - size(b.id) || natCompare(a.id, b.id));
  if (!ranked.length) return undefined;
  const id = ranked[0].id;
  const vb = before.views.find((v) => v.id === id), va = after.views.find((v) => v.id === id);
  const side = (m: Model, v: View | undefined) => {
    if (!v) return { elements: [] as string[], relationships: [] as string[] };
    const els = v.elements.filter((e) => m.elements.some((x) => x.id === e));
    return { elements: els, relationships: viewRelationships(m, v, new Set(els)).map((x) => x.id) };
  };
  const b = side(before, vb), a = side(after, va);
  const elements = [...new Map([...before.elements, ...after.elements].map((e) => [e.id, e])).values()];
  const relationships = [...new Map([...before.relationships, ...after.relationships].map((x) => [x.id, x])).values()];
  const union: Model = { ...after, elements, relationships };
  const unionView: View = { id, title: (va ?? vb)!.title, elements: [...new Set([...b.elements, ...a.elements])], relationships: [...new Set([...b.relationships, ...a.relationships])] };
  const inA = new Set(a.elements), inB = new Set(b.elements);
  const centre = [...touchedEls].filter((e) => r.added.some((t) => t.kind === "element" && t.id === e) || r.removed.some((t) => t.kind === "element" && t.id === e) || changed.has(e));
  const relCentre = [...r.added, ...r.removed].filter((t) => t.kind === "relationship").flatMap((t) => { const rel = relationships.find((x) => x.id === t.id); return rel ? [rel.from, rel.to] : []; });
  const change = changeNeighbourhood(before, after, union, centre.length ? centre : [...new Set(relCentre)]);
  const views = viewChanges(before, after);
  return {
    ...(change ? { change } : {}), views,
    view: id, title: unionView.title,
    layout: layoutView(union, unionView),
    before: b, after: a,
    added: a.elements.filter((e) => !inB.has(e)),
    removed: b.elements.filter((e) => !inA.has(e)),
    changed: a.elements.filter((e) => inB.has(e) && changed.has(e)),
    others: ranked.slice(1).map((x) => x.id),
  };
}


/** Neighbours drawn beside the changed parts before the rest are counted by zone. */
export const CHANGE_NEIGHBOUR_CAP = 14;

/**
 * The changed parts and their direct neighbours in either state, laid out once. Only
 * relationships that touch a changed part are drawn; neighbours past the cap are counted per zone, keeping first the
 * ones whose relationship the patch adds or removes, then the most connected.
 */
export function changeNeighbourhood(before: Model, after: Model, union: Model, centre: string[]): ChangeNeighbourhood | undefined {
  const C = new Set(centre.filter((id) => union.elements.some((e) => e.id === id)));
  if (!C.size) return undefined;
  const inB = new Set(before.relationships.map((x) => x.id)), inA = new Set(after.relationships.map((x) => x.id));
  const changedRel = (id: string) => inB.has(id) !== inA.has(id);
  // every relationship that touches a changed part, and every one the patch adds or removes (a new hand-off between
  // two neighbours is the point of some patches)
  const touching = union.relationships.filter((x) => C.has(x.from) || C.has(x.to) || changedRel(x.id));
  const degree = new Map<string, number>();
  for (const x of union.relationships) { degree.set(x.from, (degree.get(x.from) ?? 0) + 1); degree.set(x.to, (degree.get(x.to) ?? 0) + 1); }
  const score = new Map<string, number>();
  for (const x of touching) for (const n of [x.from, x.to]) if (!C.has(n)) score.set(n, Math.max(score.get(n) ?? 0, changedRel(x.id) ? 1000 : 0) + 0);
  const ranked = [...score.keys()].sort((a, b) => (score.get(b)! - score.get(a)!) || ((degree.get(b) ?? 0) - (degree.get(a) ?? 0)) || natCompare(a, b));
  const kept = new Set(ranked.slice(0, CHANGE_NEIGHBOUR_CAP));
  const zoneOf = new Map(union.elements.map((e) => [e.id, e.zone ?? null]));
  const more = new Map<string | null, number>();
  for (const n of ranked.slice(CHANGE_NEIGHBOUR_CAP)) more.set(zoneOf.get(n) ?? null, (more.get(zoneOf.get(n) ?? null) ?? 0) + 1);
  const elements = [...C, ...ranked.filter((n) => kept.has(n))];
  const rels = touching.filter((x) => (C.has(x.from) || kept.has(x.from)) && (C.has(x.to) || kept.has(x.to)));
  return {
    layout: egoColumns(union, [...C], elements.filter((e) => !C.has(e)), rels),
    narrow: egoColumns(union, [...C], elements.filter((e) => !C.has(e)), rels, true),
    centre: [...C], elements, relationships: rels.map((x) => x.id),
    removedRelationships: rels.filter((x) => inB.has(x.id) && !inA.has(x.id)).map((x) => x.id),
    addedRelationships: rels.filter((x) => inA.has(x.id) && !inB.has(x.id)).map((x) => x.id),
    more: [...more].map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count || natCompare(a.zone ?? "", b.zone ?? "")),
  };
}

/** Every curated view whose drawn parts or relationships differ between the two states, most changed first. */
export function viewChanges(before: Model, after: Model): ViewChange[] {
  const ids = [...new Set([...before.views, ...after.views].map((v) => v.id))];
  const side = (m: Model, v: View | undefined) => {
    if (!v) return { els: new Set<string>(), rels: new Set<string>() };
    const els = new Set(v.elements.filter((e) => m.elements.some((x) => x.id === e)));
    return { els, rels: new Set(viewRelationships(m, v, els).map((x) => x.id)) };
  };
  const out: ViewChange[] = [];
  for (const id of ids) {
    const vb = before.views.find((v) => v.id === id), va = after.views.find((v) => v.id === id);
    const b = side(before, vb), a = side(after, va);
    const ch: ViewChange = {
      view: id, title: (va ?? vb)!.title,
      elementsRemoved: [...b.els].filter((x) => !a.els.has(x)).sort(natCompare), elementsAdded: [...a.els].filter((x) => !b.els.has(x)).sort(natCompare),
      relationshipsRemoved: [...b.rels].filter((x) => !a.rels.has(x)).sort(natCompare), relationshipsAdded: [...a.rels].filter((x) => !b.rels.has(x)).sort(natCompare),
    };
    if (ch.elementsRemoved.length + ch.elementsAdded.length + ch.relationshipsRemoved.length + ch.relationshipsAdded.length) out.push(ch);
  }
  const size = (c: ViewChange) => c.elementsRemoved.length + c.elementsAdded.length + c.relationshipsRemoved.length + c.relationshipsAdded.length;
  return out.sort((x, y) => size(y) - size(x) || natCompare(x.view, y.view));
}

/**
 * A star drawn in three columns: neighbours that only send to the changed parts on the left, the changed parts in
 * the middle, the rest on the right; each column ordered by zone, then name, and centred on the tallest. Edges are
 * straight lines between facing sides, so nothing crosses the middle column. Used for a change's neighbourhood,
 * where a layered layout with zone bands sends long diagonals across every band.
 */
export function egoColumns(model: Model, centre: string[], neighbours: string[], rels: { id: string; from: string; to: string }[], narrow = false): import("../types.ts").ViewLayout {
  const C = new Set(centre);
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const zoneRank = new Map(model.zones.map((z, i) => [z.id, i]));
  const sends = new Set<string>(), receives = new Set<string>();
  for (const x of rels) { if (C.has(x.to) && !C.has(x.from)) sends.add(x.from); if (C.has(x.from) && !C.has(x.to)) receives.add(x.to); }
  const order = (a: string, b: string) => ((zoneRank.get(el.get(a)?.zone ?? "") ?? 99) - (zoneRank.get(el.get(b)?.zone ?? "") ?? 99)) || natCompare(el.get(a)?.name ?? a, el.get(b)?.name ?? b);
  const left = neighbours.filter((n) => sends.has(n) && !receives.has(n)).sort(order);
  const right = neighbours.filter((n) => !left.includes(n)).sort(order);
  const mid = [...centre].sort(order);
  if (narrow) return egoStack(el, [left, mid, right], rels);
  const cols = [left, mid, right].filter((c) => c.length);
  const gapX = 96, gapY = 18, pad = 24;
  const size = (id: string) => { const s = nodeSize(el.get(id)?.name ?? id); return { w: s.w, h: s.h }; };
  const colW = cols.map((c) => Math.max(...c.map((id) => size(id).w)));
  const colH = cols.map((c) => c.reduce((t, id) => t + size(id).h, 0) + (c.length - 1) * gapY);
  const H = Math.max(...colH);
  const nodes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  let x = pad;
  cols.forEach((c, i) => {
    let y = pad + (H - colH[i]) / 2;
    for (const id of c) { const s = size(id); nodes.push({ id, x: Math.round(x + (i === 0 ? colW[i] - s.w : i === cols.length - 1 ? 0 : (colW[i] - s.w) / 2)), y: Math.round(y), w: s.w, h: s.h }); y += s.h + gapY; }
    x += colW[i] + gapX;
  });
  const at = new Map(nodes.map((n) => [n.id, n]));
  const midNodes = nodes.filter((n) => C.has(n.id));
  const midTop = midNodes.length ? Math.min(...midNodes.map((n) => n.y)) - 18 : 0;
  const midX = midNodes.length ? midNodes[0].x + midNodes[0].w / 2 : 0;
  const edges = rels.map((e) => {
    const a = at.get(e.from)!, b = at.get(e.to)!;
    if (!a || !b) return undefined;
    const ay = a.y + a.h / 2, by = b.y + b.h / 2;
    const across = !C.has(e.from) && !C.has(e.to) && midNodes.length && Math.min(a.x, b.x) < midX && Math.max(a.x, b.x) > midX; // over the middle column, not through it
    const pts: [number, number][] = across ? (a.x < b.x ? [[a.x + a.w, ay], [midX, midTop], [b.x, by]] : [[a.x, ay], [midX, midTop], [b.x + b.w, by]])
      : a.x + a.w <= b.x ? [[a.x + a.w, ay], [b.x, by]] : b.x + b.w <= a.x ? [[a.x, ay], [b.x + b.w, by]] : [[a.x + a.w, ay], [a.x + a.w + 28, (ay + by) / 2], [b.x + b.w, by]];
    return { id: e.id, from: e.from, to: e.to, points: pts.map(([p, q]) => [Math.round(p), Math.round(q)] as [number, number]) };
  }).filter((e): e is NonNullable<typeof e> => !!e);
  return { view: "__change", width: Math.round(x - gapX + pad + 20), height: Math.round(H + 2 * pad), nodes, edges }; // room for a loop on the right
}

/**
 * The narrow form of egoColumns: senders, the changed parts and receivers in one column, with each relationship an
 * orthogonal connector in its own lane of a gutter on the left (a tree outline), so a phone reads it without panning.
 */
function egoStack(el: Map<string, { name: string }>, groups: string[][], rels: { id: string; from: string; to: string }[]): import("../types.ts").ViewLayout {
  const lanes = Math.max(1, rels.length), laneW = 6, gutter = 16 + lanes * laneW, pad = 16, gapY = 10, groupGap = 26;
  const nodes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  let y = pad, maxW = 0;
  groups.filter((g) => g.length).forEach((g, gi) => {
    if (gi) y += groupGap - gapY;
    for (const id of g) { const s = nodeSize(el.get(id)?.name ?? id); nodes.push({ id, x: gutter, y, w: s.w, h: s.h }); y += s.h + gapY; maxW = Math.max(maxW, s.w); }
  });
  const at = new Map(nodes.map((n) => [n.id, n]));
  // nested lanes: the shortest connector runs closest to the boxes, so connectors to one part never cross
  const mid = (id: string) => { const n = at.get(id); return n ? n.y + n.h / 2 : 0; };
  const drawn = rels.filter((x) => at.has(x.from) && at.has(x.to));
  const lane = new Map([...drawn].sort((p, q) => Math.abs(mid(p.from) - mid(p.to)) - Math.abs(mid(q.from) - mid(q.to)) || natCompare(p.id, q.id)).map((x, i) => [x.id, i]));
  // where each connector meets a box: spread over its left side, outer lanes at the ends
  const port = new Map<string, number>();
  for (const n of nodes) {
    const inc = drawn.filter((x) => x.from === n.id || x.to === n.id);
    const other = (x: { from: string; to: string }) => mid(x.from === n.id ? x.to : x.from);
    const above = inc.filter((x) => other(x) < mid(n.id)).sort((p, q) => lane.get(q.id)! - lane.get(p.id)!);
    const below = inc.filter((x) => other(x) >= mid(n.id)).sort((p, q) => lane.get(p.id)! - lane.get(q.id)!);
    const all = [...above, ...below], k = all.length;
    all.forEach((x, i) => port.set(n.id + "|" + x.id, k > 1 ? n.y + 6 + (i * (n.h - 12)) / (k - 1) : n.y + n.h / 2));
  }
  const edges = drawn.map((x) => {
    const a = at.get(x.from)!, b = at.get(x.to)!;
    const lx = gutter - 10 - lane.get(x.id)! * laneW, ay = port.get(a.id + "|" + x.id)!, by = port.get(b.id + "|" + x.id)!;
    return { id: x.id, from: x.from, to: x.to, points: [[a.x, ay], [lx, ay], [lx, by], [b.x, by]].map(([p, q]) => [Math.round(p), Math.round(q)] as [number, number]) };
  });
  return { view: "__change", width: Math.round(gutter + maxW + pad), height: Math.round(y - gapY + pad), nodes, edges };
}
