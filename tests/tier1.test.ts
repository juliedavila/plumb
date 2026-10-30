// Tier 1, the grammar: one filter predicate, state in the URL, the link table and its counts, the hop trail, the
// record card's field table, and the per-zone scenes with their portals. The client functions are pure, so they run
// here without a DOM, over both instances.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { renderSite, overviewTiles, index } from "../src/site/render";
import { buildBundle } from "../src/core/bundle";
import { zoneScenes } from "../src/core/zones";
import type { Bundle } from "../src/types";
import { model as M, E, R as Rel } from "./core-helpers";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };
const DE = clientOf(renderSite(ds));
const dix = DE.buildIndex(ds);

describe("URL state", () => {
  test("filters, trail and selection round-trip through the hash, ids with any character included", () => {
    const st = {
      f: { zone: ["control", "a,b=c"], grade: ["untested"], owner: ["_none"], rule: ["generic/element-has-owner"], finding: ["yes"] },
      trail: [{ kind: "element", f: { zone: ["edge~1!(x)"] } }, { link: "changed-by", f: { status: ["ready"] } }, { link: "rests-on", f: {} }],
      sel: "element:s3.action-broker" };
    const hash = DE.withState("#plan", st);
    expect(hash.startsWith("#plan?")).toBe(true);
    expect(hash).not.toMatch(/[ <>"]/);
    const back = DE.stateOf(DE.parseRoute(hash));
    expect(back.f).toEqual(st.f);
    expect(back.sel).toBe(st.sel);
    expect(back.trail).toEqual(st.trail);
  });
  test("a readable query for plain ids, in a stable facet order", () => {
    expect(DE.withState("#plan", { f: { grade: ["untested"], zone: ["edge"] } })).toBe("#plan?zone=edge&grade=untested");
  });
  test("a route's own keys stay; its state keys are replaced", () => {
    expect(DE.withState("#model/focus/x?depth=2&zone=old", { f: { zone: ["new"] } })).toBe("#model/focus/x?depth=2&zone=new");
    expect(DE.withState("#model/focus/x?depth=2&zone=old", { f: {} })).toBe("#model/focus/x?depth=2");
  });
  test("a record start round-trips too", () => {
    const t = [{ kind: "element", id: "a:b/c d", f: {} }, { link: "changed-by", f: {} }];
    expect(DE.parseTrail(DE.trailString(t))).toEqual(t);
  });
});

describe("the filter predicate", () => {
  test("a zone filter keeps the units that change a part in that zone, and only those", () => {
    const F = { zone: ["committed"] };
    const m: Set<string> = DE.matchingSet(dix, "unit", F, null);
    const want = ds.plan.units.filter((u) => (u.elements ?? []).some((mv) => ds.model.elements.find((e) => e.id === mv.id)?.zone === "committed")).map((u) => u.id);
    expect([...m].sort()).toEqual([...new Set(want)].sort());
    expect(m.size).toBeGreaterThan(0);
  });
  test("a facet no record of the page's kind carries is ignored there, and says so", () => {
    const a = DE.appliedFilters(dix, "unit", { status: ["answered"], zone: ["live"] });
    expect(a.ignored).toEqual(["status"]);
    expect(Object.keys(a.applied)).toEqual(["zone"]);
    expect(DE.matchingSet(dix, "unit", { status: ["answered"] }, null)).toBe(null);
    // "open" is every unit not done: what the Overview's open-unit bars set
    const open = DE.matchingSet(dix, "unit", { status: ["open"] }, null);
    expect([...open].sort()).toEqual(ds.plan.units.filter((u) => u.status !== "done").map((u) => u.id).filter((v, i, xs) => xs.indexOf(v) === i).sort());
  });
});

describe("links and the Follow menu", () => {
});

describe("the record card", () => {
  test("every kind declares two to four prominent fields, and each record resolves them", () => {
    const kinds = ["element", "relationship", "contract", "team", "unit", "phase", "claim", "finding", "patch", "note", "view"];
    for (const k of kinds) {
      const t = DE.CARD[k];
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(t.length).toBeLessThanOrEqual(4);
      const id = DE.recordsOf(dix, k)[0];
      expect(id).toBeDefined();
      const fs = DE.cardFields(dix, k, id);
      expect(fs.map((f: any) => f.label)).toEqual(t.map((f: any) => f[0]));
    }
    expect(DE.cardFields(dix, "unit", "U-03").map((f: any) => f.label)).toEqual(["Status", "Milestone", "Owner team", "Done when"]);
    expect(DE.cardFields(dix, "element", "ci-pipeline").map((f: any) => f.label)).toEqual(["Kind", "Zone", "Owner team", "Problems found"]);
  });
  test("an empty field reads Not set; three sizes from one renderer", () => {
    const noFinding = ds.model.elements.find((e) => !ds.findings.some((f) => f.atKind === "element" && f.at === e.id))!;
    const hover = DE.cardHtml(dix, "element", noFinding.id, "hover");
    expect(hover).toContain("Not set");
    expect(hover).not.toContain("Linked");
    const drawer = DE.cardHtml(dix, "element", "ci-pipeline", "drawer");
    expect(drawer).toContain('data-full-page');
    expect(drawer).toContain("Linked");
    expect(drawer).toContain("Work that changes it");
    const page = DE.cardHtml(dix, "element", "ci-pipeline", "page");
    expect(page).toContain("card-fields");
    expect(page).not.toContain("Linked");
    expect(DE.cardHtml(dix, "unit", "nope", "hover")).toContain("No unit nope in this build");
  });
  test("ids in prose become chips, and nothing else does", () => {
    const h = DE.linkifyText(dix, "Folds U-08 and U-09 into the gate; see P-001. Not U-999 or <b>.");
    expect(h).toContain('data-ref="unit:U-08"');
    expect(h).toContain('data-ref="patch:P-001"');
    expect(h).not.toContain('data-ref="unit:U-999"');
    expect(h).toContain("&lt;b&gt;");
  });
});

describe("zone scenes", () => {
  test("every part sits in exactly one scene, with the relationships among its zone's parts", () => {
    for (const b of [ds] as Bundle[]) {
      const scenes = b.zoneScenes!;
      expect(scenes.length).toBeGreaterThan(1);
      const seen = scenes.flatMap((s) => s.layout.nodes.map((n) => n.id));
      expect(seen.length).toBe(b.model.elements.length);
      expect(new Set(seen).size).toBe(b.model.elements.length);
      for (const s of scenes) {
        const ids = new Set(s.layout.nodes.map((n) => n.id));
        const intra = b.model.relationships.filter((r) => ids.has(r.from) && ids.has(r.to));
        expect(s.relationships).toBe(intra.length);
        expect(s.layout.edges.length).toBe(intra.length);
      }
    }
  });
  test("portal counts are the relationships crossing the border, by zone and direction, as the zone matrix counts them", () => {
    for (const b of [ds] as Bundle[]) {
      for (const s of b.zoneScenes!) {
        const z = s.zone ?? "";
        for (const p of s.portals) {
          const e = b.summary!.edges.find((x) => (p.dir === "out" ? x.from === z && x.to === (p.zone ?? "") : x.from === (p.zone ?? "") && x.to === z));
          expect(p.count).toBe(e!.count);
          expect(p.relationships.length).toBe(p.count);
        }
        const out = b.summary!.edges.filter((x) => x.from === z && x.to !== z).reduce((n, x) => n + x.count, 0);
        expect(s.portals.filter((p) => p.dir === "out").reduce((n, p) => n + p.count, 0)).toBe(out);
      }
    }
  });
  test("a small model: one scene per zone that holds parts, the parts with no zone last", () => {
    const m = M({ zones: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], elements: [E("x", { zone: "a" }), E("y", { zone: "a" }), E("z", { zone: "b" }), E("w")], relationships: [Rel("r1", "x", "y"), Rel("r2", "x", "z"), Rel("r3", "z", "y"), Rel("r4", "w", "x"), Rel("r5", "y", "z")] });
    const sc = zoneScenes(m);
    expect(sc.map((s) => s.zone)).toEqual(["a", "b", null]);
    const a = sc[0];
    expect(a.relationships).toBe(1);
    expect(a.portals.map((p) => `${p.dir}:${p.zone}:${p.count}`).sort()).toEqual(["in:b:1", "in:null:1", "out:b:2"]);
    expect(zoneScenes(M({ elements: [E("x")] }))).toEqual([]);
  });
});

describe("the Overview", () => {
});

describe("Tier 1 prose", () => {
  const { lint } = require("../src/site/prose");
  const clean = (texts: string[], sentence = true) => expect(texts.flatMap((t) => lint(t, { sentence }).map((p: string) => `${p} <<${t}>>`))).toEqual([]);
});
