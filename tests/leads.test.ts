// Named leads: an optional `lead` on a team (who runs it), a
// milestone (who owns delivering it) and a unit (who drives it). A unit's lead is its own where it sets one, else its
// owner team's (the first owner team where it has several), and the page marks which. A missing lead is never a
// finding: the page says "No lead named". Leads are wording, so the model hash leaves them out.
import { test, expect, describe } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSite } from "../src/site/render";
import { buildBundle, modelHash } from "../src/core/bundle";
import { loadInstance, normModel, normPlan } from "../src/core/load";
import { unitLeads } from "../src/core/teams";
import { ENGINE_GLOSSARY } from "../src/core/glossary";
import { statusBlock } from "../src/site/status";
import { loadTeamMap } from "../src/design/teams";
import { DS_DIR } from "./instance-dirs.ts";
import type { Bundle, Finding } from "../src/types";

const ROOT = new URL("..", import.meta.url).pathname;
const BUILT = { built: "2026-10-22T10:00:00.000Z" };
const ds = (await buildBundle(DS_DIR, BUILT)).bundle;
const dsHtml = renderSite(ds);
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };
const DE = clientOf(dsHtml);
const dix = DE.buildIndex(ds);
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** A copy of the delivery stream with every lead taken out of its model and plan. */
function withoutLeads(): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-leads-"));
  cpSync(DS_DIR, d, { recursive: true });
  writeFileSync(join(d, "model.yaml"), readFileSync(join(d, "model.yaml"), "utf8").replace(/, lead: [^}]*?(?= \})/g, ""));
  writeFileSync(join(d, "plan.yaml"), readFileSync(join(d, "plan.yaml"), "utf8").replace(/^ {4}lead: .*\n/gm, ""));
  return d;
}


describe("a unit's lead: its own, else its owner team's", () => {
  const L = ds.leads!.units;
  test("inheritance: a unit with no lead of its own takes its owner team's lead", () => {
    expect(L["U-01"]).toEqual({ lead: "the product lead", source: "team", team: "product" });
    expect(L["U-09"]).toEqual({ lead: "the platform engineering lead", source: "team", team: "platform" });
  });
  test("override: a unit's own lead wins over its owner team's", () => {
    expect(ds.teams!.units["U-05"].owners).toEqual(["product"]);
    expect(L["U-05"]).toEqual({ lead: "the delivery lead", source: "set" });
    expect(L["U-08"]).toEqual({ lead: "the test automation engineer", source: "set" });
  });
  test("several owner teams: the first one's lead, and how many there are", () => {
    const model = normModel({
      teams: [{ id: "a", name: "A", lead: "the lead of A" }, { id: "b", name: "B", lead: "the lead of B" }, { id: "c", name: "C" }],
      elements: [{ id: "p1", name: "P1", owner: "b" }, { id: "p2", name: "P2", owner: "a" }, { id: "p3", name: "P3", owner: "c" }] });
    const plan = normPlan({ phases: [{ id: "M", name: "M", order: 1 }], units: [
      { id: "U-1", phase: "M", elements: [{ id: "p1", from: "none", to: "built" }, { id: "p2", from: "none", to: "built" }] },
      { id: "U-2", phase: "M", elements: [{ id: "p3", from: "none", to: "built" }] },
      { id: "U-3", phase: "M", elements: [{ id: "p3", from: "none", to: "built" }], lead: "  the night shift  " },
      { id: "U-4", phase: "M" },
    ] });
    const l = unitLeads(model, plan);
    expect(l["U-1"]).toEqual({ lead: "the lead of A", source: "team", team: "a", of: 2 }); // registry order: A first
    expect(l["U-2"]).toEqual({ source: "none" });   // its team names no lead
    expect(l["U-3"]).toEqual({ lead: "the night shift", source: "set" });
    expect(l["U-4"]).toEqual({ source: "none" });   // no owner team, no lead
  });
});

describe("where a lead is written beside a generated plan", () => {
  test("progress.yaml: a lead alone sets the unit's lead and needs no date or by; with a status it sets both", async () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-leads-p-"));
    cpSync(DS_DIR, d, { recursive: true });
    writeFileSync(join(d, "progress.yaml"), `units:\n  U-02: { lead: the metrics analyst }\n  U-06: { status: doing, date: "2026-10-21", by: the platform engineering lead, lead: the pipeline engineer }\n`);
    const b = (await buildBundle(d, BUILT)).bundle;
    expect(b.findings.filter((f) => f.rule === "progress-valid")).toEqual([]);
    expect(b.leads!.units["U-02"]).toEqual({ lead: "the metrics analyst", source: "set" });
    expect(b.plan.units.find((u) => u.id === "U-02")?.status).toBe("done"); // the lead alone leaves the status as it was
    expect(b.leads!.units["U-06"]).toEqual({ lead: "the pipeline engineer", source: "set" });
    expect(b.plan.units.find((u) => u.id === "U-06")?.status).toBe("doing");
  });
  test("milestones.yaml: a milestone's lead over the plan's", async () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-leads-m-"));
    cpSync(DS_DIR, d, { recursive: true });
    writeFileSync(join(d, "milestones.yaml"), `milestones:\n  KEEP: { lead: the support lead }\n`);
    const b = (await buildBundle(d, BUILT)).bundle;
    expect(b.plan.phases.find((p) => p.id === "KEEP")?.lead).toBe("the support lead");
  });
});

describe("a missing lead is never a finding, and leads leave the model hash alone", () => {
  test("the delivery stream with every lead taken out has the same findings and the same model hash", async () => {
    const d = withoutLeads();
    const b = (await buildBundle(d, BUILT)).bundle;
    expect(b.model.teams.some((t) => t.lead) || b.plan.phases.some((p) => p.lead) || b.plan.units.some((u) => u.lead)).toBe(false);
    const key = (f: Finding) => `${f.pack}/${f.rule}@${f.at}: ${f.message}`;
    expect(b.findings.map(key).sort()).toEqual(ds.findings.map(key).sort());
    expect(b.engine.modelHash).toBe(ds.engine.modelHash!);
    expect(modelHash(loadInstance(d))).toBe(modelHash(loadInstance(DS_DIR)));
    expect(Object.values(b.leads!.units).every((l) => l.source === "none")).toBe(true);
  });
  test("no rule in any pack, and no finding on either instance, is about a lead", () => {
    for (const b of [ds] as Bundle[]) {
      for (const p of b.instance.packs) for (const r of p.rules) expect(`${r.id} ${r.title} ${r.why}`).not.toMatch(/\blead\b(?! time)/i);
      for (const f of b.findings) expect(f.message).not.toMatch(/\blead\b(?! time)/i);
    }
  });
});

describe("the page: who leads, set or inherited, or no lead named", () => {
  test("a unit's hover card and drawer mark its lead as inherited or set", () => {
    const inh = strip(DE.cardHtml(dix, "unit", "U-09", "hover")), set = strip(DE.cardHtml(dix, "unit", "U-05", "hover"));
    expect(inh).toContain("Lead The platform engineering lead (inherited from Platform, its owner team)");
    expect(set).toContain("Lead The delivery lead (set on this unit)");
    expect(DE.cardMore(dix, "unit", "U-05")[0].label).toBe("Lead");
    expect(strip(DE.cardHtml(dix, "unit", "U-05", "drawer"))).toContain("set on this unit");
  });
  test("several owner teams: the mark says it is the first of them", () => {
    expect(DE.unitLeadFrom(dix, { lead: "x", source: "team", team: "platform", of: 2 })).toBe("inherited from Platform, the first of its 2 owner teams");
  });
  test("a unit's page lists its lead beside its owner and verifier", () => {
    const h = DE.unitDetail(dix, "U-08");
    expect(h).toContain('data-unit-lead="U-08"');
    expect(strip(h)).toContain("Lead The test automation engineer (set on this unit)");
    expect(strip(DE.unitDetail(dix, "U-02"))).toContain("Lead The platform engineering lead (inherited from Platform, its owner team)");
  });
});

describe("present mode: a milestone's lead on the slide that says what each delivers, and in the notes", () => {
  const slide = (b: Bundle, t: string) => b.deck!.slides.find((s) => s.template === t)!;
  test("deck rule: the lead line names a lead, never a record id", () => {
    const ids = new Set([...ds.plan.units.map((u) => u.id), ...ds.plan.phases.map((p) => p.id)]);
    for (const m of slide(ds, "milestones").milestones!) for (const w of (m.leadName ?? "").split(/\s+/)) expect(ids.has(w)).toBe(false);
    const deck = dsHtml.slice(dsHtml.indexOf('class="deck'));
    const leads = [...deck.matchAll(/<p class="ms-lead">([^<]*)<\/p>/g)].map((x) => x[1]);
    expect(leads.length).toBe(3);
    for (const l of leads) expect(l).not.toMatch(/\b(SEE|SHORTEN|KEEP|U-\d+)\b/);
  });
});
