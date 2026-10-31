import { parseYaml } from "./yaml.ts";
// Tour mode data: <instance>/tour.yaml, an authored sequence of steps over live targets.
// The build checks every step against the compiled model: a step whose target (or a highlighted element) is gone
// keeps its place in the tour, says so on the page, and the build prints a warning. The tour never claims what the
// bundle cannot back.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bundle, Tour, TourStep, TourTarget } from "../types.ts";
import { patchesNamed, statusConflicts, verdictConflict } from "./text-checks.ts";

type Raw = Record<string, unknown>;
const PAGES = ["overview", "model", "plan", "checks", "changes", "strategy", "notes", "teams", "present"] as const;
const KEYS = ["view", "element", "focus", "unit", "rule", "finding", "patch", "gate", "milestone", "tracker", "claim", "note", "present", "zone"] as const;
export const TRACKER_STEPS = ["discover", "map", "match"];

const s = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

/** Normalize one raw target. Returns a problem string instead when it is not a target. */
export function normTarget(v: unknown): TourTarget | string {
  if (typeof v === "string") {
    if ((PAGES as readonly string[]).includes(v)) return v as TourTarget;
    if (v === "tracker") return { tracker: "match" };
    return `"${v}" is not a page (${PAGES.join(", ")}); name a record as a mapping, e.g. { view: <id> }`;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return "a target is a page name or a mapping such as { unit: U-05 }";
  const r = v as Raw;
  const key = KEYS.find((k) => r[k] !== undefined && r[k] !== null);
  if (!key) return `a target mapping needs one of ${KEYS.join(", ")}`;
  const id = String(r[key]);
  if (key === "focus") return { focus: id, ...(r.depth !== undefined ? { depth: Number(r.depth) === 2 ? 2 : 1 } : {}) };
  if (key === "present") return { present: Math.max(1, Math.floor(Number(r.present)) || 1) };
  return { [key]: id } as TourTarget;
}

/** Read <dir>/tour.yaml. Absent: no tour. Problems (a step that is not a mapping, a bad target) are returned, never thrown. */
export function loadTour(dir: string): { tour?: Tour; problems: string[] } {
  const path = join(dir, "tour.yaml");
  if (!existsSync(path)) return { problems: [] };
  let raw: unknown;
  try { raw = parseYaml(readFileSync(path, "utf8"),path); } catch (e) { return { problems: [`tour.yaml: YAML parse error: ${(e as Error).message}`] }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problems: ["tour.yaml: must be a mapping with title and steps"] };
  const r = raw as Raw;
  const problems: string[] = [];
  const steps: TourStep[] = [];
  (Array.isArray(r.steps) ? r.steps : []).forEach((st, i) => {
    if (!st || typeof st !== "object" || Array.isArray(st)) { problems.push(`tour.yaml step ${i + 1}: not a mapping; skipped`); return; }
    const x = st as Raw;
    const t = normTarget(x.target ?? "overview");
    if (typeof t === "string" && !(PAGES as readonly string[]).includes(t)) { problems.push(`tour.yaml step ${i + 1}: ${t}; skipped`); return; }
    const hl = Array.isArray(x.highlight) ? x.highlight.map(String) : x.highlight != null ? [String(x.highlight)] : undefined;
    steps.push({ target: t as TourTarget, title: s(x.title) ?? `Step ${i + 1}`, say: s(x.say) ?? "", ...(hl?.length ? { highlight: hl } : {}) });
  });
  if (!Array.isArray(r.steps)) problems.push("tour.yaml: steps must be a list");
  return { tour: { title: s(r.title) ?? "Tour", steps }, problems };
}

/** The record kind and id a target names, for the "is it still there" check. */
export function targetRef(t: TourTarget): { key: string; id: string } | null {
  if (typeof t === "string") return null;
  const [key, id] = Object.entries(t).find(([k]) => k !== "depth")!;
  return { key, id: String(id) };
}

/**
 * Mark each step whose target or highlight is gone from the built bundle, naming the accepted patch that removed it
 * when one did. Returns warning lines for the build to print. Mutates the steps' `missing`.
 */
export function checkTour(tour: Tour, b: Bundle): string[] {
  const has = {
    view: new Set(b.model.views.map((v) => v.id)),
    element: new Set(b.model.elements.map((e) => e.id)),
    unit: new Set(b.plan.units.map((u) => u.id)),
    gate: new Set(b.plan.phases.map((p) => p.id)),
    milestone: new Set(b.plan.phases.map((p) => p.id)),
    patch: new Set(b.patches.map((p) => p.id)),
    rule: new Set(b.instance.packs.flatMap((p) => p.rules.map((r) => `${p.name}/${r.id}`))),
    finding: new Set(b.findings.map((f) => `${f.pack}/${f.rule}@${f.at}`)),
    claim: new Set((b.model.claims ?? []).map((c) => c.id)),
    note: new Set((b.notes?.items ?? []).map((n) => n.id)),
    zone: new Set((b.zoneScenes ?? []).map((z) => z.zone ?? "_none")),
  } as Record<string, Set<string>>;
  const removedBy = (kind: string, id: string) => {
    for (const p of b.patches) {
      if (p.status !== "accepted") continue;
      const im = p.impact;
      if ([...im.removed, ...im.cascade].some((r) => r.kind === kind && r.id === id)) return p.id;
    }
    return undefined;
  };
  const kindOf: Record<string, string> = { view: "view", element: "element", focus: "element", unit: "unit", gate: "phase", milestone: "phase", claim: "claim" };
  const warnings: string[] = [];
  tour.steps.forEach((st, i) => {
    delete st.missing;
    const ref = targetRef(st.target);
    const gone: string[] = [];
    // the deck and the Teams page exist only when the instance has a deck.yaml, and a model with teams
    if (st.target === "present" && !b.deck?.slides.length) gone.push("this instance has no deck (deck.yaml)");
    if (st.target === "teams" && !b.teams) gone.push("this instance declares no teams");
    if (ref && ref.key === "present") {
      const n = Number(ref.id), have = b.deck?.slides.length ?? 0;
      if (!have) gone.push("this instance has no deck (deck.yaml)");
      else if (n > have) gone.push(`the deck has ${have} slides, not ${n}`);
    } else if (ref) {
      const set = ref.key === "focus" ? has.element : ref.key === "tracker" ? undefined : has[ref.key];
      let ok = set ? set.has(ref.id) : true;
      if (ref.key === "tracker") ok = !!b.tracker && TRACKER_STEPS.includes(ref.id);
      if (!ok) {
        const by = kindOf[ref.key] ? removedBy(kindOf[ref.key], ref.id) : undefined;
        const what = ref.key === "finding" ? `the finding ${ref.id} no longer fires` : ref.key === "tracker" ? (b.tracker ? `the tracker has no "${ref.id}" step` : "this instance has no tracker") : `${ref.key} ${ref.id} is not in the model${by ? ` (removed by ${by})` : ""}`;
        gone.push(what);
      }
    }
    for (const h of st.highlight ?? []) if (!has.element.has(h)) {
      const by = removedBy("element", h);
      gone.push(`highlighted element ${h} is not in the model${by ? ` (removed by ${by})` : ""}`);
    }
    if (gone.length) {
      st.missing = gone.join("; ");
      warnings.push(`tour step ${i + 1} ("${st.title}"): ${st.missing}`);
    }
    // a caption that states a verdict or a status is checked against what the build computed
    const words = `${st.title}. ${st.say}`;
    const shown = ref?.key === "patch" ? b.patches.filter((p) => p.id === ref.id) : patchesNamed(st.say, b);
    for (const p of shown) { const bad = p.impact.verdict ? verdictConflict(words, p.impact.verdict.level) : undefined; if (bad) warnings.push(`tour step ${i + 1} ("${st.title}"): ${bad}`); }
    for (const bad of statusConflicts(st.say, b)) warnings.push(`tour step ${i + 1} ("${st.title}"): ${bad}`);
  });
  return warnings;
}
