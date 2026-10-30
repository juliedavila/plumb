// Demo tour behavior:
// The zone step explains zones and opens the band just shown; a person can propose a change, and the review says
// who did; a glossary on hover and focus; where questions come from; tracker disagreements explain how to settle
// them; Finish ends the tour; hover cards carry what references do not.
import { test, expect, describe } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSite } from "../src/site/render";
import { buildBundle, modelHash } from "../src/core/bundle";
import { loadInstance } from "../src/core/load";
import { ENGINE_GLOSSARY, glossary } from "../src/core/glossary";
import { SETTLE, PLAN_VS_TRACKER } from "../src/tracker/settle";
import { NOTES_SOURCE } from "../src/site/strategy";
import { DS_DIR } from "./instance-dirs.ts";
import type { Bundle } from "../src/types";

const ROOT = new URL("..", import.meta.url).pathname;
const BUILT = { built: "2026-10-22T10:00:00.000Z" };
const ds = (await buildBundle(DS_DIR, BUILT)).bundle;
const dsHtml = renderSite(ds);
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };
const DE = clientOf(dsHtml);
const dix = DE.buildIndex(ds);
const zoneOf = (b: Bundle, id: string) => b.model.elements.find((e) => e.id === id)?.zone;
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the zone step says what a zone is, and opens the band just shown", () => {
  for (const [name, b] of [["delivery-stream", ds]] as const) {
    test(`${name}: every zone step follows a step that highlights that band in a view, and says so`, () => {
      const steps = b.tour!.steps;
      const zoneSteps = steps.map((s, i) => ({ s, i })).filter(({ s }) => typeof s.target === "object" && "zone" in s.target);
      expect(zoneSteps.length).toBeGreaterThan(0);
      for (const { s, i } of zoneSteps) {
        const zone = (s.target as { zone: string }).zone, prev = steps[i - 1];
        expect(typeof prev.target === "object" && "view" in prev.target).toBe(true);
        expect(prev.highlight?.length).toBeGreaterThan(0);
        for (const h of prev.highlight!) expect(zoneOf(b, h)).toBe(zone);
        expect(prev.say).toMatch(/This band is the .* zone/);
        expect(s.say).toMatch(/band from the drawing just shown/);
        expect(s.missing).toBeUndefined();
      }
      // the view step before the band names the bands as zones
      const firstView = steps.find((s) => typeof s.target === "object" && "view" in s.target)!;
      expect(firstView.say).toMatch(/zones?/);
    });
  }
  test("the delivery stream's band step highlights every committed part the stream view draws", () => {
    const steps = ds.tour!.steps, i = steps.findIndex((s) => typeof s.target === "object" && "zone" in s.target);
    const view = ds.model.views.find((v) => v.id === "stream")!;
    expect([...steps[i - 1].highlight!].sort()).toEqual(view.elements.filter((e) => zoneOf(ds, e) === "committed").sort());
  });
});

describe("a person can propose a change, and the review says who did", () => {
  const p1 = ds.patches.find((p) => p.id === "P-001")!, p2 = ds.patches.find((p) => p.id === "P-002")!;
  test("P-002 is a person's: author person, a role for requested_by, a real reason; it passes and fixes two findings", () => {
    expect(p2.provenance?.author).toBe("person");
    expect(p2.provenance?.requested_by).toBe("the product lead");
    expect(p2.status).toBe("proposed");
    expect(p2.why.length).toBeGreaterThan(120);
    expect(p2.impact.verdict?.level).toBe("pass");
    expect(p2.impact.findingsResolved.map((f) => `${f.pack}/${f.rule}`).sort()).toEqual(["flow/queue-has-wip-limit", "plan/done-unit-holds"]);
  });
  test("P-001 keeps its verdict, and the milestones keep their colours", async () => {
    expect(p1.impact.verdict?.level).toBe("caution");
    const d = mkdtempSync(join(tmpdir(), "plumb-ds-nop2-"));
    cpSync(DS_DIR, d, { recursive: true });
    rmSync(join(d, "patches/P-002-cap-roadmap-backlog.yaml"));
    const without = (await buildBundle(d, BUILT)).bundle;
    rmSync(d, { recursive: true, force: true });
    const colours = (b: Bundle) => b.status!.milestones.map((m) => `${m.phase}:${m.status}/${m.computed}`);
    expect(colours(ds)).toEqual(colours(without));
    expect(ds.status!.overall).toEqual(without.status!.overall);
    expect(without.patches.find((p) => p.id === "P-001")!.impact.verdict).toEqual(p1.impact.verdict);
  });
  test("the card and the change list say who proposed it", () => {
    expect(DE.proposedBy(p1)).toBe("An agent (Claude Code), at the request of the delivery lead");
    expect(DE.proposedBy(p2)).toBe("The product lead, a person");
    expect(DE.cardFields(dix, "patch", "P-002").map((f: any) => f.label)).toContain("Proposed by");
    expect(dsHtml).toMatch(/data-patch-row="P-002"[\s\S]*?<span>By the product lead<\/span>/);
  });
});

describe("a glossary: generic terms in the engine, instance terms in engine.yaml", () => {
  test("the engine defines the words a newcomer meets", () => {
    const names = ENGINE_GLOSSARY.map((e) => e[0]);
    for (const t of ["critical path", "unit", "capability", "milestone", "zone", "premise", "verdict"]) expect(names).toContain(t);
    for (const [, def] of ENGINE_GLOSSARY) { expect(def.length).toBeGreaterThan(30); expect(def.length).toBeLessThan(220); }
  });
  test("an instance overrides a term by its name and adds its own; a term with no definition is a warning", () => {
    const g = glossary({ glossary: { Zone: "Where a change stands.", "value stream": { definition: "The path a change takes.", forms: ["stream"] }, broken: 3 } });
    const zone = g.terms.find((t) => t.term === "zone")!;
    expect(zone).toMatchObject({ definition: "Where a change stands.", source: "instance", forms: ["zone", "zones"] });
    expect(g.terms.find((t) => t.term === "value stream")).toMatchObject({ forms: ["stream"], source: "instance" });
    expect(g.problems).toEqual(['engine.yaml glossary: "broken" has no definition; skipped']);
    expect(glossary({ glossary: "nope" }).problems.length).toBe(1);
  });
  test("the glossary is wording: it leaves the model hash alone", () => {
    const inst = loadInstance(join(ROOT, "examples/delivery-stream"));
    const h = modelHash(inst);
    inst.config.glossary = { zone: "Something else entirely." };
    expect(modelHash(inst)).toBe(h);
  });
  test("each term marks its first use only, plurals and longer forms first, skipping what is already seen", () => {
    const ms = DE.glossMatches(dix, "Units on the critical path wait on capabilities; a unit's milestone, and its milestones.");
    expect(ms.map((m: any) => m.term)).toEqual(["unit", "critical path", "capability", "milestone"]);
    const seen = new Set(["unit"]);
    expect(DE.glossMatches(dix, "A unit in a zone", seen).map((m: any) => m.term)).toEqual(["zone"]);
    expect(DE.glossMatches(dix, "Partly zoned, unitary").length).toBe(0);
    expect(DE.glossMatches(dix, "The value stream, end to end").map((m: any) => m.term)).toEqual(["value stream"]);
  });
  test("the page wires a tooltip on hover and keyboard focus, with Escape, styled from the theme tokens", () => {
    for (const doc of [dsHtml]) {
      const client = doc.slice(doc.lastIndexOf("<script>"));
      expect(client).toContain('s.tabIndex = 0; s.setAttribute("role", "term")');
      expect(client).toMatch(/addEventListener\("focusin"[^\n]*\.gl/);
      expect(client).toMatch(/addEventListener\("mouseover"[^\n]*\n[^\n]*\.gl/);
      expect(client).toContain('ev.key === "Escape" && !tip.hidden');
      expect(client).toContain('setAttribute("aria-describedby", "gloss-tip")');
      expect(client).toContain('S.glossify([$("tour-title"), $("tour-say")])');
      const css = doc.slice(doc.indexOf("<style>"), doc.indexOf("</style>"));
      const rules = css.split("\n").filter((l) => /^\.gl\b|^\.gloss-tip/.test(l));
      expect(rules.length).toBeGreaterThan(2);
      for (const r of rules) expect(r).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
    }
  });
});

describe("where questions come from", () => {
  test("the Notes page and both tours say notes.yaml, written by people, agents and the page; nothing pulled", () => {
    expect(NOTES_SOURCE).toMatch(/notes\.yaml/);
    expect(NOTES_SOURCE).toMatch(/Nothing is pulled from a tracker, chat or any other tool/);
    for (const doc of [dsHtml]) expect(doc).toContain('<p class="small fg2" id="notes-source">');
    for (const b of [ds]) {
      const st = b.tour!.steps.find((s) => s.target === "notes")!;
      expect(st.say).toMatch(/notes\.yaml, written by people, by agents and by (this|the) page under the dev server; nothing is pulled from a tracker or chat/);
    }
  });
});

describe("each tracker disagreement says why it appears and how to settle it", () => {
  test("every kind has both lines, and each settle line names a side and how", () => {
    for (const [k, g] of Object.entries(SETTLE)) {
      expect(g.appears.length, k).toBeGreaterThan(40);
      expect(g.settle, k).toMatch(/tracker|plan|patch|links\.yaml|progress\.yaml|mapping\.yaml/);
    }
    expect(SETTLE.status.settle).toMatch(/progress\.yaml/);
    expect(SETTLE.status.settle).toMatch(/move the issue in the tracker/);
    expect(SETTLE.status.settle).toMatch(/tracker\/mapping\.yaml/);
  });
  test("the Match step shows them under every group that has entries, and says plan versus tracker once", () => {
    const tr = dsHtml.slice(dsHtml.indexOf('id="tracker"'), dsHtml.indexOf("</section>\n", dsHtml.indexOf('data-tr-step="match"')));
    expect(tr.split('id="plan-vs-tracker"').length - 1).toBe(1);
    expect(strip(tr)).toContain(PLAN_VS_TRACKER.slice(0, 40).replace("'", "&#39;"));
    for (const id of ["status", "deps", "phase", "owner", "proposed", "no-unit", "no-issue"]) {
      const at = dsHtml.indexOf(`id="tracker-${id}"`);
      expect(at, id).toBeGreaterThan(0);
      const sec = dsHtml.slice(at, dsHtml.indexOf("</section>", at));
      expect(sec, id).toContain("Why this appears");
      expect(sec, id).toContain("To settle it");
    }
    const deps = dsHtml.slice(dsHtml.indexOf('id="tracker-deps"'), dsHtml.indexOf("</section>", dsHtml.indexOf('id="tracker-deps"')));
    expect(deps).toContain("Only in the plan");
    expect(deps).toContain("Only in the tracker");
    // the status row says how the tracker's status was read
    expect(strip(dsHtml)).toMatch(/In Progress \(read as doing by its name in tracker\/mapping\.yaml\)/);
  });
  test("the tracker pack's rules carry the same lines as their how", () => {
    const pack = ds.instance.packs.find((p) => p.name === "tracker")!;
    for (const id of ["status-agrees", "phase-agrees", "dependency-both-sides", "owner-agrees", "issue-has-unit", "labels-name-units"]) {
      const r = pack.rules.find((x) => x.id === id)!;
      expect(r.how, id).toMatch(/^It appears when: .* To settle it: /);
    }
  });
});

describe("Finish ends the tour", () => {
  test("past the last step the tour finishes: it leaves, returns where it started, and says how to replay it", () => {
    const client = dsHtml.slice(dsHtml.lastIndexOf("<script>"));
    expect(client).toContain("if (n > tour.steps.length && S.tour.on) { tourFinish(); return; }");
    expect(client).toContain('if (!S.tour.on) S.tour.from = S.beforePresent || "#overview";');
    expect(client).toMatch(/function tourFinish\(\) \{[\s\S]*?tourExit\(true\);\s*S\.go\(from\);\s*S\.toast\(/);
    expect(client).toContain('is finished. Press T, or Tour in the header, to replay it.');
    expect(client).toContain("S.tour.lastBy[which] = 1;");
  });
});

describe("a hover card carries what the reference does not", () => {
  test("a unit: why it stands where it does, what it unblocks, its tracker state", () => {
    const more = DE.cardMore(dix, "unit", "U-05");
    const labels = more.map((f: any) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Why", "Blocking", "Tracker"]));
    const text = strip(DE.cardHtml(dix, "unit", "U-05", "hover"));
    expect(text).toMatch(/Blocking \d+ units wait on it/);
    expect(text).toMatch(/Owner team Product/);
    expect(text).toMatch(/Milestone See the stream/);
  });
  test("a blocked unit names what it waits on; a claim its tests and open questions", () => {
    const open = (id: string) => ds.plan.units.find((x) => x.id === id)?.status !== "done";
    const blocked = ds.plan.units.find((u) => (u.status ?? "todo") === "todo" && !ds.analysis.frontier.includes(u.id) && (ds.analysis.deps[u.id] ?? []).some(open))!;
    const more = DE.cardMore(dix, "unit", blocked.id);
    expect(more.find((f: any) => f.label === "Why").html).toMatch(/^Blocked until/);
    expect(more.find((f: any) => f.label === "Blocked by").html).toContain('data-ref="unit:');
    const claim = DE.cardMore(dix, "claim", "PR-2");
    expect(claim.find((f: any) => f.label === "Open questions").html).toMatch(/1 open question/);
  });
  test("a part: its zone and the units that change it", () => {
    const text = strip(DE.cardHtml(dix, "element", "ci-pipeline", "hover"));
    expect(text).toMatch(/Zone Committed/);
    expect(text).toMatch(/Work that changes it \d+ units? change it/);
    expect(strip(DE.cardHtml(dix, "element", "idea-inbox", "hover"))).toMatch(/Work that changes it (No unit changes it yet|\d+ units? change it)/);
  });
});
