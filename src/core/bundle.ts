// Build the bundle: load, compile accepted patches, check, analyze, impact of every patch, layout every view, hash.

import type { Bundle, ComposedDesign, Finding, Instance, RulePack } from "../types.ts";
import { compile } from "./compile.ts";
import { checkCompiled, computeImpact, orphanedUnits, orphanFinding } from "./impact.ts";
import { layoutAll, viewsOf } from "./layout.ts";
import { DEFAULT_LADDER, loadInstance, packNames, patchKey } from "./load.ts";
import { analyzePlan } from "./plan.ts";
import { compareFindings, corePack, loadPacks, packsFor } from "./rules.ts";
import { nsBuildFindings } from "./compose.ts";
import { bundleCurrent } from "./current.ts";
import { canonicalJson, sha256 } from "./util.ts";
import { bundleTracker } from "../tracker/bundle.ts";
import { modelSummary, viewGroups } from "./summary.ts";
import { zoneScenes } from "./zones.ts";
import { checkTour } from "./tour.ts";
import { allPremiseImpacts } from "./premise.ts";
import { findingNoteId, sortNotes } from "./notes.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildDiff } from "../types.ts";
import { loadReports, reportRef, sinceReport, statusHistory } from "./snapshot.ts";
import { teamFacts, unitLeads } from "./teams.ts";
import { buildDeck, loadDeckConfig } from "./deck.ts";
import { planStatus } from "./status.ts";
import { flowBadgeLines, flowFacts, claimFlowChecks } from "./flow.ts";
import { streamLayout } from "./flow-layout.ts";
import { instanceMeasured } from "./flow-measured.ts";

// 0.5.0: standalone Plumb, verified edition additions and generated Obsidian vaults.
// 0.5.1 and 0.5.2: wording only.
export const ENGINE_VERSION = "0.5.2";

/** sha256 of the canonical JSON of the inputs: instance config, model, plan, patches. No timestamp, no absolute paths. */
export function contentHash(inst: Instance): string {
  const t = inst.tracker;
  const tracker = t ? { inventory: t.inventory, mapping: t.mapping, links: t.links, issues: t.issues } : undefined;
  const base: Record<string, unknown> = { instance: inst.ns?.configWritten ?? inst.config, model: inst.model, plan: inst.plan, patches: inst.patches, tracker, tour: inst.tour, notes: inst.notes?.notes };
  // a 0.4 design's build also rests on its root (its files and the root patches applied to them), the edition built and the designs composed with it
  const ns = inst.ns, r = ns?.root?.input;
  const rootPatches = r?.patches?.filter((p) => r.applied?.includes(p.id)) ?? [];
  if (ns) base.ns = { root: r ? { shared: r.shared?.sha256, manual: r.shared?.manualWorkFile?.sha256, org: r.org?.sha256, ...(rootPatches.length ? { patches: sha256(canonicalJson(rootPatches)) } : {}) } : undefined, edition: inst.edition?.sha256, compose: ns.compose?.map((d) => [d.namespace, d.edition ?? "latest", d.editionSha256]) };
  if (inst.current) base.current = inst.current; // current state is live, like progress: it moves the build, not the model hash
  return sha256(canonicalJson(base));
}

/** sha256 of the base model only (instance config, model, plan): what a patch is written against. Patches, the tracker and the tour leave it unchanged. */
export function modelHash(inst: Instance): string {
  // A milestone's words, target date and status override, and a unit's due date, are status, not structure: a patch
  // written against the model stays current when they change, and engine.yaml's status criteria likewise. A named
  // lead (a team's, a milestone's, a unit's) is who, not structure: a name filled in for a real deployment leaves every patch current.
  const plan = {
    phases: inst.plan.phases.map(({ delivers: _d, means: _m, target: _t, override: _o, flow_target: _f, accountable: _a, confirmed_by: _c, lead: _l, ...p }) => p),
    units: inst.plan.units.map(({ due: _due, lead: _l, ...u }) => u),
  };
  const model = { ...inst.model, teams: inst.model.teams.map(({ lead: _l, ...t }) => t) };
  // engine.yaml's status criteria, where the tracker export lives, which importer wrote it and the glossary's words: none is structure.
  const { status: _s, tracker: _tr, importer: _im, glossary: _g, ...config } = inst.ns?.configWritten ?? inst.config;
  return sha256(canonicalJson({ instance: config, model, plan }));
}

export interface BuildResult { bundle: Bundle; instance: Instance; packs: RulePack[]; warnings: string[] }

/** `previous`: an earlier bundle of this instance, whose layer orders seed the layout (the dev loop passes it, so a rebuild does not reshuffle a drawing). */
import { addReaderText } from "./reader.ts";
import { glossary } from "./glossary.ts";

export async function buildBundle(dirOrInstance: string | Instance, opts: { built?: string; previous?: Bundle; edition?: string; compose?: ComposedDesign[] } = {}): Promise<BuildResult> {
  const inst = typeof dirOrInstance === "string" ? loadInstance(dirOrInstance, { ...(opts.edition !== undefined ? { edition: opts.edition } : {}), ...(opts.compose ? { compose: opts.compose } : {}) }) : dirOrInstance;
  // Flow values' age is counted to the build date; a build time that is not a date (tests pass "x") counts no age.
  const builtAt = opts.built ?? new Date().toISOString();
  inst.asOf = /^\d{4}-\d{2}-\d{2}/.test(builtAt) ? builtAt.slice(0, 10) : undefined;
  const loaded = await loadPacks(packNames(inst));
  const packs = packsFor(loaded.packs, !!inst.ns), packErrors = loaded.errors; // a 0.4 design gets the rules packs add for 0.4

  const compiled = compile(inst);
  const core: Finding[] = [];
  for (const e of packErrors) core.push({ pack: "core", rule: "pack-loads", severity: "error", at: e.name, atKind: "instance", message: `pack ${e.name} did not load: ${e.message}` });
  core.push(...(inst.loadFindings ?? []));
  if (inst.ns) core.push(...inst.ns.findings, ...nsBuildFindings(inst, compiled)); // a 0.4 design: schema, namespace, root, pins and stale pins
  for (const p of inst.patches) for (const msg of compiled.resultsByKey[patchKey(p)]?.errors ?? [])
    core.push({ pack: "core", rule: "patch-applies", severity: "error", at: p.id, atKind: "instance", message: msg });
  // Units the accepted patches left with no part to move.
  const cascaded = new Set(Object.values(compiled.resultsByKey).flatMap((r) => r.cascade.filter((x) => x.kind === "unit").map((x) => x.id)));
  for (const u of orphanedUnits(inst.plan, compiled.plan, cascaded)) {
    const before = inst.plan.units.find((x) => x.id === u)!;
    core.push(orphanFinding(u, before.title, (before.elements ?? []).map((m) => inst.model.elements.find((e) => e.id === m.id)?.name ?? m.id)));
  }
  const checked = checkCompiled(inst, compiled, packs);
  const findings = [...core, ...checked];
  // Notes on findings: checked once every rule has run, against the findings of the design of record.
  if (inst.notes && packs.some((p) => p.name === "notes")) {
    const ids = new Set(findings.map(findingNoteId));
    for (const n of inst.notes.notes) if (n.target.kind === "finding" && !ids.has(n.target.id))
      findings.push({ pack: "notes", rule: "target-exists", severity: "warning", at: n.id, atKind: "note", message: `${n.kind === "question" ? "Question" : "Note"} ${n.id} is pinned to finding ${n.target.id}, which no longer fires` });
  }
  findings.sort(compareFindings);

  const memo = new Map();
  const coreSet = new Set(core);
  memo.set("accepted", { c: compiled, f: findings.filter((f) => !coreSet.has(f)) });
  const patches = inst.patches.map((p) => ({ ...p, impact: computeImpact(inst, patchKey(p), packs, memo) }));

  const model = compiled.model;
  if (!model.views.length) model.views = viewsOf(model); // the default "all" view, so the site's view picker has one
  const layouts = layoutAll(model, opts.previous?.layouts);

  const introduced = patches.flatMap((p) => p.impact.findingsIntroduced.filter((f) => f.pack === "core"));
  const usedPacks = findings.some((f) => f.pack === "core") || introduced.length ? [corePack(!!inst.ns, [...findings, ...introduced]), ...packs] : packs;
  const bundle: Bundle = {
    engine: { version: ENGINE_VERSION, built: opts.built ?? new Date().toISOString(), hash: contentHash(inst), modelHash: modelHash(inst) },
    instance: {
      name: inst.config.name, title: inst.config.title, ...(inst.config.description ? { description: inst.config.description } : {}),
      packs: usedPacks.map((p) => ({ name: p.name, title: p.title, description: p.description, rules: p.rules.map((r) => ({ id: r.id, title: r.title, why: r.why, severity: r.severity, ...(r.how ? { how: r.how } : {}) })) })),
      ladder: inst.config.ladder ?? DEFAULT_LADDER,
      ...instance04(inst, compiled.ns?.homes),
    },
    model, plan: compiled.plan,
    findings,
    analysis: analyzePlan(compiled.plan),
    patches,
    layouts,
  };
  addReaderText(bundle, inst.ns?.root?.input?.shared?.capabilities); // reader wording leaves input hashes unchanged
  // The rule set's version: every pack, rule and severity. A snapshot keeps it, so a new rule reads as a change in the checks.
  bundle.engine.rules = sha256(canonicalJson(bundle.instance.packs.map((p) => ({ p: p.name, r: p.rules.map((r) => `${r.id}:${r.severity}`) })))).slice(0, 12);
  if (inst.tracker) bundle.tracker = bundleTracker(inst.tracker, compiled.model, compiled.plan);
  // current state: each record with its provenance, how each retirement stands, transition work (src/core/current.ts)
  if (compiled.current) bundle.current = bundleCurrent(compiled.plan, compiled.current, inst, inst.config.ladder ?? DEFAULT_LADDER);
  bundle.analysis.unblocksTransitive ??= {};
  bundle.viewGroups = viewGroups(model.views, inst.model.views.map((v) => v.id));
  const summary = modelSummary(model);
  if (summary) bundle.summary = summary;
  const scenes = zoneScenes(model, opts.previous?.zoneScenes);
  if (scenes.length) bundle.zoneScenes = scenes;
  if (model.claims?.length) bundle.premises = allPremiseImpacts(model, compiled.plan);
  if (model.teams.length) bundle.teams = teamFacts(model, compiled.plan, inst.config, bundle.analysis);
  // each unit's lead: its own, else its owner team's (the first owner team), else none; a missing one is never a finding
  if (compiled.plan.units.length) bundle.leads = { units: unitLeads(model, compiled.plan, bundle.teams?.units) };
  // Flow: only for an instance that checks a value stream (the flow pack) and has a stream view to show.
  if (packs.some((p) => p.name === "flow")) {
    const facts = flowFacts(model, inst.config, inst.asOf ?? "", instanceMeasured(inst));
    if (facts.streams.length) {
      bundle.flow = facts;
      for (const [id, chk] of Object.entries(claimFlowChecks(model, facts))) if (bundle.premises?.[id]) bundle.premises[id].flow = chk;
      // A stream view is drawn as its path in reading order, wrapped to fit the width, with room for its badges.
      for (const st of facts.streams) {
        const v = model.views.find((x) => x.id === st.view);
        const i = bundle.layouts.findIndex((l) => l.view === st.view);
        if (v && i >= 0) bundle.layouts[i] = streamLayout(model, v, st.path, (id) => flowBadgeLines(model, facts, id));
      }
    }
  }
  if (inst.notes) bundle.notes = { version: inst.notes.version, items: sortNotes(inst.notes.notes) };
  const comparisons = loadComparisons(inst.dir);
  if (comparisons.length) bundle.comparisons = comparisons;
  const warnings: string[] = [...(inst.loadWarnings ?? []), ...(inst.tourProblems ?? []).map((p) => `warning: ${p}`), ...(inst.notes?.problems ?? []).map((p) => `warning: ${p}`), ...(inst.milestoneProblems ?? []).map((p) => `warning: ${p}`)];
  // The glossary: the engine's terms with engine.yaml's additions and overrides (src/core/glossary.ts).
  const gl = glossary(inst.config, { v04: !!inst.ns?.root }); // a design that imports a shared root gets 0.4's terms; a lone instance never does
  bundle.glossary = gl.terms;
  warnings.push(...gl.problems.map((p) => `warning: ${p}`));
  // Status: red, amber or green per milestone, with reasons and the path to green (engine.yaml status: criteria).
  const importer = inst.config.importer;
  if (importer && typeof importer === "object" && !Array.isArray(importer)) {
    const r = importer as Record<string, unknown>;
    bundle.importer = Object.fromEntries(["tool", "version", "titles"].filter((k) => r[k] != null).map((k) => [k, String(r[k])]));
  }
  const reports = loadReports(inst.dir);
  if (bundle.plan.phases.length) {
    const st = planStatus(bundle, inst.config, { reports });
    bundle.status = st.status;
    // "If this is false" names the milestones at stake the way status counts them, so the claim page and the road agree.
    for (const [id, ms] of Object.entries(st.atStake)) if (bundle.premises?.[id]) bundle.premises[id].atStake = ms;
    for (const [id, ms] of Object.entries(st.amberBy)) if (bundle.premises?.[id] && ms.length) bundle.premises[id].amberBy = ms;
    warnings.push(...st.problems.map((p) => `warning: ${p}`));
  }
  // Report snapshots (plumb report): the list, and what changed since the last one presented (else the last saved),
  // after the status, so a comparison can say which milestone went from amber to red.
  if (reports.length) {
    bundle.reports = reports.map(reportRef);
    const since = sinceReport(bundle, reports);
    if (since) bundle.sinceReport = since;
  }
  if (bundle.status) bundle.history = statusHistory(bundle, reports);
  // Present mode: <instance>/deck.yaml, built last so its slides read everything above.
  const deck = loadDeckConfig(inst.dir);
  warnings.push(...deck.problems.map((p) => `warning: ${p}`));
  if (deck.config) {
    const d = buildDeck(bundle, deck.config);
    bundle.deck = d.deck;
    warnings.push(...d.warnings.map((w) => `warning: ${w}`));
  }
  // The tour last: a step may target the deck or the Teams page.
  if (inst.tour) {
    bundle.tour = structuredClone(inst.tour);
    warnings.push(...checkTour(bundle.tour, bundle).map((w) => `warning: ${w}`));
  }
  return { bundle, instance: inst, packs, warnings };
}

/** A 0.4 design's place in the import graph, for the page; a released edition's label. Nothing for a lone working copy. */
function instance04(inst: Instance, homes?: Record<string, string>): Partial<Bundle["instance"]> {
  const out: Partial<Bundle["instance"]> = {};
  const ns = inst.ns;
  if (ns) {
    out.schema = ns.schema;
    if (ns.namespace) out.namespace = ns.namespace;
    if (ns.root) out.root = ns.root.path;
    if (ns.pins.length) out.pins = ns.pins;
    if (homes && Object.keys(homes).length) out.homes = homes;
  }
  if (inst.edition) out.edition = { version: inst.edition.version, ...(inst.edition.stamp.date ? { date: inst.edition.stamp.date } : {}), sha256: inst.edition.sha256 };
  return out;
}

/** Saved comparisons between builds: <instance>/diffs/*.json, written by `plumb diff --save`. Unreadable files are skipped. */
export function loadComparisons(dir: string): BuildDiff[] {
  const d = join(dir, "diffs");
  if (!existsSync(d)) return [];
  const out: BuildDiff[] = [];
  for (const f of readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
    try { const j = JSON.parse(readFileSync(join(d, f), "utf8")); if (j && j.from && j.to && j.counts) out.push(j); } catch { /* skipped */ }
  }
  return out;
}
